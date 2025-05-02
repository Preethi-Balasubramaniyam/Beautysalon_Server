import { IMessagingService } from './iMessagingService';
import { IMessage, IMessageInput, Status, Endpoint, Channel } from '../../types/commTypes';
import Message, { DBMessage } from '../../models/message';
import { User } from '../../types/userTypes';
import logger from '../../common/logger';
import { Op } from 'sequelize';

export class MessageProcessor {
    private messagingServices: Map<string, Set<IMessagingService>>;
    private subscriptions: Set<Endpoint> = new Set();
    private isProcessing: boolean = false;
    private orgId: string;
    private processingInterval: NodeJS.Timeout | null = null;

    constructor(orgId: string) {
        this.messagingServices = new Map();
        this.orgId = orgId;
    }

    public getOrgId(): string {
        return this.orgId;
    }

    public async getAllOrgEndpoints(): Promise<Endpoint[]> {
        const allEndpoints: Endpoint[] = [];

        // Get endpoints from all messaging services
        for (const services of this.messagingServices.values()) {
            for (const service of services) {
                const endpoints = await service.listOrgEndpoints();
                allEndpoints.push(...endpoints);
            }
        }

        return allEndpoints;
    }


    public addSubscription(watcher: Endpoint): void {   
        if (watcher.channel !== Channel.app) {
            throw new Error('Cannot subscribe to non-app channel');
        }
        this.subscriptions.add(watcher);
    }

    public removeSubscription(watcher: Endpoint): void {
        this.subscriptions.delete(watcher);
    }

    public addMessagingService(channel: Channel, service: IMessagingService): void {
        if (!this.messagingServices.has(channel)) {
            this.messagingServices.set(channel, new Set());
        }
        this.messagingServices.get(channel)?.add(service);
    }

    public getMessagingService(channel: Channel, fromEndpoint?: Endpoint): IMessagingService | undefined {
        const services = this.messagingServices.get(channel);
        if (!services || services.size === 0) {
            return undefined;
        }

        
        if (channel === Channel.whatsapp && fromEndpoint?.externalId) {
            for (const service of services) {
                const endpoints = service.listOrgEndpoints();
                if (endpoints && endpoints.length > 0 && endpoints.some(endpoint => endpoint.externalId === fromEndpoint.externalId)) {
                    return service;
                }
            }
        }
        // For other channels, use the first available service
        return Array.from(services)[0];
    }

    public async processAndUpdateMessage(message: IMessage): Promise<IMessage> {
        const updatedMessage = await this.processMessage(message);

        const updateData: Partial<DBMessage> = {
            status: updatedMessage.status,
            externalId: updatedMessage.externalId ? updatedMessage.externalId : message.externalId,
            externalMetaData: {
                ...message.externalMetaData,
                ...updatedMessage.externalMetaData
            },
            metaData: {
                ...message.metaData,
                ...updatedMessage.metaData
            }
        };

        const updateOptions: {
            where: { id: string };
        } = {
            where: { id: message.id }
        };

        await Message.update(updateData, updateOptions);

        return updatedMessage;
    }

    /**
     * Handles a message from a client. It persists the message, processes it and updates the socket clients that are subscribed to the org.
     * @param messageData - The message data
     * @param user - The user who sent the message
     * @returns The message or throws an error if it failed
     */
    public async handleMessage(messageData: IMessageInput, user: User, existingId?: string): Promise<IMessage> {
        try {
            logger.info('Handling message: %o', messageData);

            // Create or update the message
            const message = Message.mapInterface2DBModel(messageData, user);
            let createdMessage;
            
            if (existingId) {
                logger.info('Updating existing message: %o', existingId);
                createdMessage = await Message.findByPk(existingId);
                if (!createdMessage) {
                    throw new Error('Message not found');
                }
                const createdPojo = createdMessage.toJSON();
                createdMessage = {
                    ...createdPojo,
                    ...message,
                    metaData: {
                        ...createdPojo.metaData,
                        ...message.metaData
                    },
                    externalMetaData: {
                        ...createdPojo.externalMetaData,
                        ...message.externalMetaData
                    }
                };
            } else {
                // Create new message
                createdMessage = await Message.create(message);
            }
            const messageInterface = await Message.mapDBModel2Interface(createdMessage);

            // Fix: Process queued messages if they are for app channel, 
            // or if they're scheduled for now or the past, or within 5 minutes in the future
            const now = new Date();
            const fiveMinutesInFuture = new Date(now.getTime() + 5 * 60 * 1000);
            
            const isDefferedMessage = message.status === Status.queued && new Date(message.timestamp) >= fiveMinutesInFuture;
            
            let updatedMessage: IMessage = messageInterface;
            if (isDefferedMessage) {
                logger.info('Message is scheduled to be processed later.');
            } else {
                logger.info('Processing message: %o', messageInterface);    
                updatedMessage = await this.processAndUpdateMessage(messageInterface);
            }

            logger.info('Updating to org clients: %o', updatedMessage);    

            // Update clients if the message is related to org endpoints
            const orgEndpointIds = (await this.getAllOrgEndpoints()).map(endpoint => endpoint.id);
            if (orgEndpointIds.includes(updatedMessage.from.id) || orgEndpointIds.includes(updatedMessage.to.id)) {
                await this.updateClients(updatedMessage);
            }

            return updatedMessage;
        } catch (error) {
            logger.error('Error handling message:', error);
            throw error;
        }
    }

    /**
     * Processes a message
     * @param message - The message to process
     * @returns The processed message or message with failed status if it failed
     */
    private async processMessage(message: IMessage): Promise<IMessage> {
        const service = this.getMessagingService(message.channel, message.from);
        
        if (!service) {
            logger.error(`No messaging service found for message: ${message.id}`);
            return {
                ...message,
                status: Status.failed,
                metaData: {
                    ...message.metaData,
                    statusReason: 'No messaging service found'
                }
            };
        }

        if (!service.validateMessage(message)) {
            logger.error(`Invalid message for service: ${service.id}`);
            return {
                ...message,
                status: Status.failed,
                metaData: {
                    ...message.metaData,
                    statusReason: 'Invalid message for service'
                }
            };
        }

        try {
            // Get all org endpoints for this channel
            const orgEndpoints = await this.getAllOrgEndpoints();
            const isToEndpointOrg = orgEndpoints.some(endpoint => endpoint.id === message.to.id);
            const isFromEndpointOrg = orgEndpoints.some(endpoint => endpoint.id === message.from.id);

            let updatedMessage = message;

            // Handle app channel messages
            if (message.channel === Channel.app) {
                const socketService = this.getMessagingService(Channel.app);
                if (!socketService) {
                    logger.error('No socket service found for app channel');
                    return {
                        ...message,
                        status: Status.failed,
                        metaData: {
                            ...message.metaData,
                            statusReason: 'No socket service found'
                        }
                    };
                }

                if (!message.externalId || !message.metaData?.lastSent) {
                    // Send message to to endpoint
                    const sentMessage = await socketService.sendMessage(message);
                    updatedMessage = {
                        ...updatedMessage,
                        ...sentMessage,
                        metaData: {
                            ...updatedMessage.metaData,
                            ...sentMessage.metaData
                        },
                        externalMetaData: {
                            ...updatedMessage.externalMetaData,
                            ...sentMessage.externalMetaData
                        }
                    }
                } else if (this.shouldSendToExternalService(message)) {
                    // Update status of message to from endpoint
                    await socketService.updateStatus(updatedMessage, message.from);
                    updatedMessage = {
                        ...updatedMessage,
                        status: Status.sent,
                        metaData: {
                            ...updatedMessage.metaData,
                            lastSent: {
                                status: updatedMessage.status,
                                timestamp: new Date().toISOString(),
                                externalId: updatedMessage.externalId
                            }
                        }
                    }
                }

            }

            // Handle non-app channel messages
            if (message.channel !== Channel.app) {
                if (isToEndpointOrg && message.externalId) {
                    // Only update status for messages where toEndpoint is org
                    // Check if we need to send status update
                    const needsStatusUpdate = this.shouldSendToExternalService(message);
                    if (!needsStatusUpdate) {
                        logger.info(`Message ${message.id} does not need status update`);
                        return updatedMessage;
                    }

                    try {
                        const { success, errorMessage } = await service.updateStatus(message);
                        if (!success) {
                            logger.warn('Failed to update message status:', errorMessage);
                        } else {
                            logger.info('Message status updated:', message);
                            updatedMessage = {
                                ...message,
                                status: message.status,
                                metaData: {
                                    ...message.metaData,
                                    lastSent: {
                                        status: message.status,
                                        timestamp: new Date().toISOString(),
                                        externalId: message.externalId
                                    }
                                }
                            };
                        }
                    } catch (error) {
                        logger.error('Error checking message status:', error);
                    }
                } else if (isFromEndpointOrg) {
                    // Only send message for messages where fromEndpoint is org
                    if (message.externalId || message.metaData?.lastSent) {
                        logger.info(`Message ${message.id} does not need external service communication`);
                        return updatedMessage;
                    }

                    // Send to external service and update metadata
                    const externalResponse = await service.sendMessage(message);
                    
                    // Update metadata with what was sent
                    updatedMessage = {
                        ...externalResponse,
                        metaData: {
                            ...externalResponse.metaData,
                            lastSent: {
                                status: externalResponse.status,
                                timestamp: new Date().toISOString(),
                                externalId: externalResponse.externalId
                            }
                        }
                    };
                }
            }

            return updatedMessage;
        } catch (error) {
            return {
                ...message,
                status: Status.failed,
                metaData: {
                    ...message.metaData,
                    lastError: {
                        message: error instanceof Error ? error.message : 'Unknown External Error',
                        timestamp: new Date().toISOString()
                    }
                }
            };
        }
    }

    private shouldSendToExternalService(message: IMessage): boolean {
        const lastSent = message.metaData?.lastSent;

        // Always send if No lastSent record (message has never been sent to external service)
        if (!lastSent) {
            return true;
        }

        // Check if status has changed in a way that needs to be communicated
        const statusChanged = lastSent.status !== message.status;
        if (!statusChanged) {
            return false;
        }

        // Only send status updates for certain status changes
        const statusTransitions: Record<Status, Status[]> = {
            [Status.queued]: [Status.sent, Status.failed],
            [Status.sent]: [Status.delivered, Status.failed],
            [Status.delivered]: [Status.read, Status.failed],
            [Status.read]: [Status.failed],
            [Status.failed]: [],
            [Status.cancelled]: []
        };

        return statusTransitions[lastSent.status]?.includes(message.status) ?? false;
    }

    private async updateClients(message: IMessage): Promise<void> {
        try {
            // Get the socket service for this organization
            const socketService = this.getMessagingService(Channel.app);
           
            if (!socketService) {
                logger.warn('No socket service found for organization:', this.orgId);
                return;
            }
            const watchers: Set<Endpoint> = this.subscriptions;

            for (const watcher of watchers) {
                socketService.sendMessage(message, watcher);
            }
            return;
        } catch (error) {
            logger.error('Error updating clients:', error);
        }
    }

    public async startProcessing(): Promise<void> {
        if (this.isProcessing) {
            return;
        }

        this.isProcessing = true;
        this.processingInterval = setInterval(async () => {
            try {
                await this.processQueuedMessages();
            } catch (error) {
                logger.error('Error processing queued messages:', error);
            }
        }, 15000 * 60); // Process every 15 minutes
        logger.info(`Started message processor for organization ${this.orgId}`);
    }

    public stopProcessing(): void {
        if (this.processingInterval) {
            logger.info(`Stopping message processor for organization ${this.orgId}`);
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }
        this.isProcessing = false;
    }

    private async processQueuedMessages(): Promise<void> {
        if (this.isProcessing) {
            return;
        }

        this.isProcessing = true;
        try {
            // Get all messages that need processing
            const messages = await Message.findAll({
                where: {
                    orgId: this.orgId,
                    [Op.or]: [
                        { status: Status.queued },
                        { 
                            status: Status.sent,
                            externalId: { [Op.ne]: '' },
                            updatedAt: { 
                                [Op.lt]: new Date(Date.now() - 5 * 60 * 1000) // Check status every 5 minutes
                            }
                        }
                    ]
                }
            });

            for (const message of messages) {
                try {
                    const messageInterface = await Message.mapDBModel2Interface(message);
                    const service = this.getMessagingService(messageInterface.channel, messageInterface.from);

                    if (service && messageInterface.externalId) {
                        // For sent messages, check status
                        if (messageInterface.status === Status.sent) {
                            const { success, errorMessage } = await service.updateStatus(messageInterface);
                            if (!success) {
                                logger.warn(`Failed to update status for message ${message.id}:`, errorMessage);
                            }
                        } else {
                            // For queued messages, process normally
                            await this.processAndUpdateMessage(messageInterface);
                        }
                    }
                } catch (error) {
                    logger.error(`Error processing message ${message.id}:`, error);
                }
            }
        } catch (error) {
            logger.error('Error processing queued messages:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    public async updateMessage(messageData: IMessage, user: User): Promise<IMessage | null> {
        try {
            const message = await Message.findByPk(messageData.id);
            if (!message) {
                return null;
            }

            const service = this.getMessagingService(messageData.channel, messageData.from);
            if (service && messageData.externalId) {
                // If the message has an external ID, check its status
                const { success, errorMessage } = await service.updateStatus(messageData);
                if (!success) {
                    logger.warn(`Failed to update status for message ${messageData.id}:`, errorMessage);
                }
            }

            const messageInput: IMessageInput = {
                fromId: messageData.from.id,
                toId: messageData.to.id,
                senderId: messageData.sender.id,
                content: messageData.content,
                timestamp: messageData.timestamp,
                status: messageData.status,
                type: messageData.type,
                channel: messageData.channel,
                externalId: messageData.externalId,
                externalMetaData: messageData.externalMetaData,
                metaData: messageData.metaData
            };

            await Message.update(Message.mapInterface2DBModel(messageInput, user), {
                where: { id: messageData.id }
            });

            const updatedMessage = await Message.findByPk(messageData.id);
            if (!updatedMessage) {
                return null;
            }

            return await Message.mapDBModel2Interface(updatedMessage);
        } catch (error) {
            logger.error('Error updating message:', error);
            return null;
        }
    }

    public removeMessagingService(channel: Channel): void {
        this.messagingServices.delete(channel);
    }

} 