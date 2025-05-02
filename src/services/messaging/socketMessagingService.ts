import { Socket } from 'socket.io';
import { IMessage, Channel, Status, Endpoint, IMessageInput } from '../../types/commTypes';
import { IMessagingService } from './iMessagingService';
import { User } from '../../types/userTypes';
import logger from '../../common/logger';
import oauth from '../../oauthServer';
import EndpointModel from '../../models/endpoint';
import { MessageProcessor } from './messageProcessor';
import socketServer from '../socketServer';
import { Request, Response } from 'oauth2-server';
import Message from '../../models/message';
import { Op } from 'sequelize';
import DBUser from '../../models/user';
import { MessageValidator } from '../../utils/messageValidation';
import winston from 'winston';

// Extend Socket type to include our custom properties
interface CustomSocket extends Socket {
    user?: User;
    fromEndpoint?: Endpoint;
    logger: winston.Logger;
}

export class SocketMessageService implements IMessagingService {
    private messageProcessor: MessageProcessor;
    private orgId: string;
    private userSockets: Map<string, Set<CustomSocket>> = new Map();
    private orgEndpoints: Endpoint[] = [];
    private orgEndpointExternalIds: string[];
    private messageValidator: MessageValidator;
    public readonly id: string;

    constructor(messageProcessor: MessageProcessor, orgId: string, endpointIds: string[]) {
        this.messageProcessor = messageProcessor;
        this.orgId = orgId;
        this.id = `socket_${orgId}`;
        this.orgEndpointExternalIds = endpointIds;
        this.messageValidator = new MessageValidator(orgId);
    }

    public async initialize(): Promise<void> {
        for (const endpointId of this.orgEndpointExternalIds) {
            const endpoint = await EndpointModel.findOrCreateByExternalId(this.orgId, endpointId, Channel.app, endpointId);
            this.orgEndpoints.push(endpoint);
        }

        this.setupSocketServer();
        logger.info('Socket service initialized successfully');
    }

    private setupSocketServer(): void {
        const io = socketServer.getIO();
        // Create a namespace for this organization
        const orgNamespace = io.of(`/${this.orgId}`);
       
        orgNamespace.use(async (socket: Socket, next) => {
            // Initialize logger for this socket
            (socket as CustomSocket).logger = logger.child({ socketId: socket.id });
            const customSocket = socket as CustomSocket;
            
            const token = Array.isArray(socket.handshake.query.token) ? socket.handshake.query.token[0] : socket.handshake.query.token;
            if (!token) {
                customSocket.logger.warn('No token provided for socket connection');
                return next(new Error('Authentication required. Token is missing.'));
            }

            const user = await this.authenticateClient(token || '', customSocket);
            if (!user) {
                customSocket.logger.warn('Invalid token provided for socket connection');
                return next(new Error('Authentication failed: Invalid token'));
            }

            if (user.orgId !== this.orgId) {
                customSocket.logger.warn('User does not belong to this organization');
                return next(new Error('Access denied: User does not belong to this organization'));
            }

            customSocket.user = user;
            customSocket.fromEndpoint = await EndpointModel.findOrCreateByExternalId(this.orgId, user.id, Channel.app, user.name, user, user.id);
            customSocket.logger.info('Client authenticated. Socket user: %o', customSocket.user);
            next();
        });

        orgNamespace.on('connection', async (socket: Socket) => {
            const customSocket = socket as CustomSocket;
            customSocket.logger.info('Socket connected: %s', socket.id);
            
            if (!customSocket.user || !customSocket.fromEndpoint) {
                customSocket.logger.error('No authenticated user or from endpoint found for socket connection');
                socket.disconnect();
                return;
            }

            // Send auth_success event after successful connection
            socket.emit('auth_success', customSocket.user);

            // Add socket to user's socket set
            if (!this.userSockets.has(customSocket.user.id)) {
                this.userSockets.set(customSocket.user.id, new Set());
            }
            this.userSockets.get(customSocket.user.id)?.add(customSocket);

            // Add the socket to the message processor's subscriptions
            this.messageProcessor.addSubscription(customSocket.fromEndpoint);

            // Process any queued messages for this user
            await this.processQueuedMessagesForUser(customSocket.fromEndpoint.id);

            socket.on('message', async (messageData: IMessageInput) => {
                try {
                    customSocket.logger.info('Received message from socket client: %o', messageData);
                    if (!customSocket.user || !customSocket.fromEndpoint) {
                        customSocket.logger.error('No authenticated user or from endpoint found for socket connection');
                        return;
                    }

                    const messageInput = {
                        ...messageData,
                        senderId: customSocket.fromEndpoint.id,
                    };

                    // Validate message using shared validator
                    const validationError = await this.messageValidator.validateMessage(messageData);

                    if (validationError) {
                        const failedMessage = {
                            ...messageData,
                            status: Status.failed,
                            externalMetaData: {
                                socket: { error: validationError }
                            }
                        };
                        customSocket.logger.error('Invalid message: %o', failedMessage);
                        socket.emit('message', failedMessage);
                        return;
                    }

                    // Get the message processor for this organization
                    const message = await this.messageProcessor.handleMessage(messageInput, customSocket.user);
                    socket.emit('message', message);
                } catch (error) {
                    customSocket.logger.error('Error handling socket message:', error);
                }
            });

            socket.on('read', async (messageId: string) => {
                try {
                    customSocket.logger.info('Received read event for message: %s', messageId);
                    if (!customSocket.user || !customSocket.fromEndpoint) {
                        customSocket.logger.error('No authenticated user or from endpoint found for socket connection');
                        return;
                    }

                    // Find the message by ID
                    const message = await Message.findOne({
                        where: {
                            id: messageId,
                            orgId: this.orgId
                        }
                    });

                    if (!message) {
                        customSocket.logger.warn('Message not found for read event: %s', messageId);
                        return;
                    }

                    // Convert to IMessageInput for status update
                    const messageInput: IMessageInput = {
                        fromId: message.fromId,
                        toId: message.toId,
                        senderId: message.senderId,
                        content: message.content,
                        timestamp: message.timestamp,
                        status: Status.read,
                        type: message.type,
                        channel: message.channel,
                        externalId: message.externalId,
                        externalMetaData: {
                            ...message.externalMetaData,
                            socket: {
                                ...message.externalMetaData?.socket,
                                readTimestamp: new Date().toISOString()
                            }
                        }
                    };

                    // Update message status through message processor
                    await this.messageProcessor.handleMessage(messageInput, customSocket.user, messageId);
                } catch (error) {
                    customSocket.logger.error('Error handling read event:', error);
                }
            });

            socket.on('disconnect', () => {
                customSocket.logger.info('Socket.IO client disconnected %s', socket.id);
                if (customSocket.user) {
                    customSocket.logger.info('Removing client %s for user: %s', socket.id, customSocket.user.id);
                    this.userSockets.get(customSocket.user.id)?.delete(customSocket);
                    if (this.userSockets.get(customSocket.user.id)?.size === 0) {
                        this.userSockets.delete(customSocket.user.id);
                    }
                    if (customSocket.fromEndpoint) {
                        this.messageProcessor.removeSubscription(customSocket.fromEndpoint);
                    }
                    customSocket.user = undefined;
                    customSocket.fromEndpoint = undefined;
                }
            });

            socket.emit('connection', 'Socket.IO connection established');
        });
    }

    private async authenticateClient(token: string, socket: CustomSocket): Promise<User | null> {
        try {
            const request = new Request({
                method: 'GET',
                headers: { authorization: `Bearer ${token}` },
                query: {},
                body: {}
            });
            const response = new Response();

            const authToken = await oauth.authenticate(request, response);
            if (!authToken) {
                socket.logger.warn('Token authentication failed: %o', authToken);
                return null;
            }

            socket.logger.info('Token authentication successful: %o', authToken);

            return {
                id: authToken.user.id,
                username: authToken.user.username,
                role: authToken.user.role,
                scope: authToken.user.scope,
                name: authToken.user.name,
                mobile: authToken.user.mobile,
                email: authToken.user.email,
                serviceProviderId: authToken.user.serviceProviderId,
                orgId: authToken.user.orgId
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
            socket.logger.error(`Error Authenticating token ${token}: ${error.message}`);
            return null;
        }
    }

    public async validateMessage(message: IMessage): Promise<boolean> {
        // First check if it's a socket message
        if (message.channel !== Channel.app) {
            return false;
        }

        try {
            // Check if the destination endpoint's externalId exists in userSockets
            // This means the user is currently active in the organization
            if (!this.userSockets.has(message.to.externalId)) {
                return false;
            }

            // Check if the user exists in the database and belongs to the organization
            const user = await DBUser.findOne({
                where: {
                    id: message.to.externalId,
                    orgId: this.orgId
                }
            });

            return !!user;
        } catch (error) {
            logger.error('Error validating message:', error);
            return false;
        }
    }

    public async sendMessage(message: IMessage, endpoint?: Endpoint): Promise<IMessage> {
        // Use a generic ID for these logs since they're not tied to a specific socket
        const socketLogger = logger.child({ socketId: `socket_${this.orgId}` });
        socketLogger.info('Sending message to socket: %o to endpoint: %o', message, endpoint);
        if (endpoint) {
            this.userSockets.get(endpoint.externalId)?.forEach(socket => {
                socket.emit('message', message);
            });
            return message;
        }

        if (!this.validateMessage(message)) {
            return {
                ...message,
                status: Status.failed,
                externalMetaData: {
                    socket: {
                        error: 'Invalid message type for socket',
                        timestamp: new Date().toISOString()
                    }
                }
            };
        }

        if (this.orgEndpointExternalIds.includes(message.to.externalId)) {
            return {
                ...message,
                status: Status.delivered,
                externalId: `socket_${message.id}`,
                externalMetaData: {
                    socket: {
                        message: 'Org Endpoint found',
                        timestamp: new Date().toISOString()
                    }
                }
            };
        }

        try {
            // Get all sockets for the recipient user
            const recipientSockets = this.userSockets.get(message.to.externalId);
            if (!recipientSockets || recipientSockets.size === 0) {
                return {
                    ...message,
                    status: Status.sent,
                    externalId: `socket_${message.id}`,
                    externalMetaData: {
                        socket: {
                            message: 'Recipient not online',
                            timestamp: new Date().toISOString()
                        }
                    }
                };
            }

            // Send message to all recipient's sockets
            recipientSockets.forEach(socket => {
                socket.emit('message', message);
            });

            return {
                ...message,
                status: Status.delivered,
                externalId: `socket_${message.id}`,
                externalMetaData: {
                    socket: {
                        message: 'Message delivered to recipient',
                        timestamp: new Date().toISOString()
                    }
                }
            };
        } catch (error) {
            socketLogger.error('Error sending socket message:', error);
            return {
                ...message,
                status: Status.failed,
                externalMetaData: {
                    socket: {
                        error: error instanceof Error ? error.message : 'Unknown error occurred',
                        timestamp: new Date().toISOString()
                    }
                }
            };
        }
    }

    public listOrgEndpoints(): Endpoint[] {
        return this.orgEndpoints;
    }

    public async updateStatus(message: IMessage, endpoint?: Endpoint): Promise<{ success: boolean; errorMessage?: string }> {
        try {
            // For socket messages, we can directly update the status since it's all in-memory
            // We'll also notify the recipient if they're connected
            const updateEndpointId = endpoint?.id || message.from.externalId;
            const userSockets = this.userSockets.get(updateEndpointId);
            if (userSockets) {
                for (const socket of userSockets) {
                    socket.emit('message', message);
                }
            }
            return { success: true };
        } catch (error) {
            logger.error('Error updating socket message status: %o', error);
            return { 
                success: false, 
                errorMessage: error instanceof Error ? error.message : 'Unknown error occurred' 
            };
        }
    }

    private async processQueuedMessagesForUser(endpointId: string): Promise<void> {
        const socketLogger = logger.child({ socketId: `endpoint_${endpointId}` });
        try {
            const messages = await Message.findAll({
                where: {
                    orgId: this.orgId,
                    status: Status.sent,
                    channel: Channel.app,
                    toId: endpointId,
                    timestamp: {
                        [Op.lte]: new Date()
                    }
                },
                order: [['timestamp', 'ASC']]
            });

            socketLogger.info('Processing %d queued messages for endpoint: %s', messages.length, endpointId);                                         

            for (const message of messages) {
                const messageInterface = await Message.mapDBModel2Interface(message);
                await this.messageProcessor.processAndUpdateMessage(messageInterface);
            }
        } catch (error) {
            socketLogger.error('Error processing queued messages for endpoint:', error);
        }
    }
} 