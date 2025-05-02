import { TemplateMessageComponent, WABAClient, WebhookContact, WebhookMessage, WebhookMetadata, WebhookStatus } from 'whatsapp-business';
import { IMessage, MessageContentType, Status, Channel, IMessageInput, Endpoint, MessageType, MessageContent } from '../../types/commTypes';
import { IMessagingService } from './iMessagingService';
import Message from '../../models/message';
import { SUPPORTED_LANGUAGES_CODES } from 'whatsapp-business/dist/src/types/languageCodes';
import logger from '../../common/logger';
import { UserScope, UserRole } from '../../types/userTypes';
import { MessageProcessor } from './messageProcessor';
import axios from 'axios';
import EndpointModel from '../../models/endpoint';
import { upload2S3 } from '../s3Service';
import { v4 as uuidv4 } from 'uuid';
import { WhatsAppWebhookHandler } from './whatsappWebhookHandler';

export class WhatsAppService implements IMessagingService {
    private messageProcessor: MessageProcessor;
    private wabaClient: WABAClient | undefined;
    private phoneNumber: string;
    private accountId: string;
    private phoneId: string;
    private orgId: string;
    private authToken: string;
    private endpoint: Endpoint | undefined;
    public id: string;

    constructor(messageProcessor: MessageProcessor, config: {
        authToken: string;
        phoneNumber: string;
        accountId: string;
        phoneId: string;
    }, orgId: string) {
        this.messageProcessor = messageProcessor;
        this.authToken = config.authToken;
        this.phoneNumber = config.phoneNumber;
        this.accountId = config.accountId;
        this.phoneId = config.phoneId;
        this.orgId = orgId;
        this.id = config.phoneNumber;
    }

    public async initialize(): Promise<void> {
        try {
            // Find or create the endpoint (this needs to be awaited)
            this.endpoint = await EndpointModel.findOrCreateByExternalId(
                this.orgId, 
                this.phoneNumber, 
                Channel.whatsapp, 
                this.phoneNumber, 
                {
                    wa_id: this.accountId,
                    phone_id: this.phoneId,
                }
            );

            this.id = this.endpoint.id;
            
            // Initialize WABA client
            this.wabaClient = new WABAClient({
                apiToken: this.authToken,
                phoneId: this.phoneId,
                accountId: this.accountId
            });

            // Register with webhook handler
            const webhookHandler = WhatsAppWebhookHandler.getInstance();
            webhookHandler.registerCallback({
                phoneId: this.phoneId,
                accountId: this.accountId,
                orgId: this.orgId,
                handleMessage: this.handleWebhookMessage.bind(this),
                handleStatus: this.handleWebhookStatus.bind(this)
            });

            logger.info('WhatsApp service initialized for phone number: %s', this.phoneNumber);
            
            // Start the background task without awaiting it
            this.fetchWhatsAppBusinessInfo();
        } catch (error) {
            logger.error('Error initializing WhatsApp service:', error);
            throw error; // Re-throw the error so callers know initialization failed
        }
    }

    /**
     * Fetches WhatsApp business information in the background
     * This method doesn't block the service initialization
     */
    private fetchWhatsAppBusinessInfo(): void {
        if (!this.wabaClient) {
            logger.warn('Cannot fetch WhatsApp business info: WABA client not initialized');
            return;
        }

        // Run these API calls in the background
        Promise.all([
            this.wabaClient.getBusinessProfile(),
            this.wabaClient.getHealthStatus(),
            this.wabaClient.getBusinessPhoneNumbers()
        ]).then(([businessProfile, healthStatus, businessPhoneNumbers]) => {
            logger.info('Business Profile: %o', businessProfile);
            logger.info('Health Status: %o', healthStatus);
            logger.info('Business Phone Numbers: %o', businessPhoneNumbers);
            logger.info('WhatsApp business info fetched successfully');
        }).catch(error => {
            logger.error('Error fetching WhatsApp business info:', error);
        });
    }

    private async handleWebhookMessage(
        payload: WebhookMessage,
        contact: WebhookContact,
        metadata?: WebhookMetadata
    ): Promise<void> {
        try {
            const existingMessage = await Message.findOne({
                where: {
                    externalId: payload.id,
                    orgId: this.orgId,
                    channel: Channel.whatsapp
                }
            });

            const from = await EndpointModel.findOrCreateByExternalId(this.orgId, payload.from, Channel.whatsapp, contact.profile?.name, {
                wa_id: contact.wa_id });
            
            if (!this.endpoint) {
                logger.warn('WhatsApp endpoint is not initalizing. Dropping message payload:%o, contact:%o, metadata:%o', payload, contact, metadata);
                return;
            }

            const message: IMessageInput = {
                fromId: from.id,
                toId: this.endpoint.id,
                senderId: from.id,
                content: await this.getWhatsAppMessageContent(payload),
                timestamp: new Date(parseInt(payload.timestamp) * 1000),
                status: Status.delivered,
                type: MessageType.support,
                channel: Channel.whatsapp,
                externalId: payload.id,
                externalMetaData: {
                    whatsapp: {
                        payload,
                        contact,
                        metadata
                    }
                }
            };

            await this.messageProcessor.handleMessage(message, {
                id: `system@${this.orgId}`,
                username: `system@${this.orgId}`,
                name: 'System User',
                orgId: this.orgId,
                scope: [UserScope.Admin],
                role: UserRole.Admin,
                email: `system@${this.orgId}.com`,
                mobile: ''
            }, existingMessage?.id);
        } catch (error) {
            logger.error('Error handling received message:', error);
        }
    }

    private async handleWebhookStatus(
        status: WebhookStatus
    ): Promise<void> {
        try {
            // Find the message by external ID
            const dbMessage = await Message.findOne({
                where: { externalId: status.id }
            });

            if (!dbMessage) {
                logger.warn(`Message not found for status update: ${status.id}`);
                return;
            }

            // Update the message status
            const newStatus = this.mapWhatsAppStatus(status.status);

            // Convert IMessage to IMessageInput
            const messageInput: IMessageInput = {
                fromId: dbMessage.fromId,
                toId: dbMessage.toId,
                senderId: dbMessage.senderId,
                content: dbMessage.content,
                timestamp: dbMessage.timestamp,
                status: newStatus,
                type: dbMessage.type,
                channel: dbMessage.channel,
                externalId: dbMessage.externalId,
                externalMetaData: {
                    ...dbMessage.externalMetaData,
                    whatsapp: {
                        ...dbMessage.externalMetaData?.whatsapp,
                        status: status,
                        timestamp: new Date().toISOString()
                    }
                }
            };

            // Notify the message processor
            await this.messageProcessor.handleMessage(messageInput, {
                id: 'system',
                username: 'system',
                name: 'System User',
                orgId: this.orgId,
                scope: [UserScope.ServiceProvider],
                role: UserRole.ServiceProvider,
                email: `system@${this.orgId}.com`,
                mobile: ''
            }, dbMessage.id);
        } catch (error) {
            logger.error('Error handling status update:', error);
        }
    }

    private mapWhatsAppStatus(whatsappStatus: string): Status {
        switch (whatsappStatus) {
            case 'sent':
                return Status.sent;
            case 'delivered':
                return Status.delivered;
            case 'read':
                return Status.read;
            case 'failed':
                return Status.failed;
            default:
                return Status.queued;
        }
    }

    private async fetchMediaUrl(mediaId: string): Promise<string> {
        try {
            const response = await axios.get(`https://graph.facebook.com/v19.0/${mediaId}`, {
                headers: {
                    Authorization: `Bearer ${this.authToken}`
                }
            });
            return response.data.url;
        } catch (error) {
            logger.error('Error fetching media URL from WhatsApp API:', error);
            throw new Error('Failed to fetch media URL');
        }
    }

    private async uploadMediaToS3(mediaId: string, mediaType: string): Promise<string> {
        try {
            const mediaUrl = await this.fetchMediaUrl(mediaId);
            const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
            const fileName = `${uuidv4()}.${mediaType.split('/')[1]}`;
            const oneYearInMilliseconds = 365 * 24 * 60 * 60 * 1000; // One year
            return await upload2S3(response.data, fileName, mediaType, Date.now() + oneYearInMilliseconds);
        } catch (error) {
            logger.error('Error uploading media to S3:', error);
            throw new Error('Failed to upload media to S3');
        }
    }

    private async getWhatsAppMessageContent(payload: WebhookMessage): Promise<MessageContent> {
        if (payload.text) {
            return {
                type: MessageContentType.text,
                text: payload.text?.body || ''
            };
        }
        if (payload.image || payload.video || payload.audio || payload.document) {
            const media = payload.image || payload.video || payload.audio || payload.document;
            const mediaType = media?.mime_type || 'application/octet-stream';
            const mediaId = media?.id;

            if (mediaId) {
                try {
                    const s3Url = await this.uploadMediaToS3(mediaId, mediaType);

                    let contentType: MessageContentType;
                    if (mediaType.startsWith('image/')) {
                        contentType = MessageContentType.image;
                    } else if (mediaType.startsWith('video/')) {
                        contentType = MessageContentType.video;
                    } else if (mediaType.startsWith('audio/')) {
                        contentType = MessageContentType.audio;
                    } else if (mediaType.startsWith('application/')) {
                        contentType = MessageContentType.document;
                    } else {
                        contentType = MessageContentType.text;
                    }

                    return {
                        type: contentType,
                        url: s3Url,
                    };
                } catch {
                    return {
                        type: MessageContentType.text,
                        text: 'Failed to process media message'
                    };
                }
            }
        }
        
        return {
            type: MessageContentType.text,
            text: 'Unknown message content'
        };
    }

    public async validateMessage(message: IMessage): Promise<boolean> {
        return this.wabaClient !== undefined && message.from.channel === Channel.whatsapp && message.to.channel === Channel.whatsapp &&
               (message.content.type === MessageContentType.text || 
                message.content.type === MessageContentType.template ||
                message.content.type === MessageContentType.pdf ||
                message.content.type === MessageContentType.image ||
                message.content.type === MessageContentType.video);
    }

    public async sendMessage(message: IMessage, endpoint: Endpoint): Promise<IMessage> {
        
        if (endpoint) {
            throw new Error('WhatsApp service does not support overriding endpoints');
        }

        if (!this.wabaClient) {
            return {
                ...message,
                status: Status.failed,
                externalMetaData: {
                    whatsapp: {
                        error: 'WhatsApp client not initialized',
                        timestamp: new Date().toISOString(),
                        phoneNumberId: this.phoneId,
                        accountId: this.accountId
                    }
                }
            };
        }

        logger.info('Sending WhatsApp message: %o', message);

        try {
            let response;
            if (message.content.type === MessageContentType.template) {
                const templateComponents: TemplateMessageComponent[] = [ {
                    type: 'body',
                    parameters: Object.entries(message.content.templateParams || {}).map(([key, value]) => ({
                        type: 'text',
                        text: value,
                        parameter_name: key
                    }))
                }];
                response = await this.wabaClient.sendMessage({
                    to: message.to.externalId,
                    type: 'template',
                    template: {
                        name: message.content.templateName || 'hello_world',
                        language: {
                            code: SUPPORTED_LANGUAGES_CODES.English_US,
                            policy: 'deterministic'
                        },
                        components: templateComponents
                    }
                });
            } else if (message.content.type === MessageContentType.text) {
                response = await this.wabaClient.sendMessage({
                    to: message.to.externalId,
                    type: 'text',
                    text: { body: message.content.text || '' }
                });
            } else if (message.content.type === MessageContentType.pdf) {
                response = await this.wabaClient.sendMessage({
                    to: message.to.externalId,
                    type: 'document',
                    document: {
                        link: message.content.url,
                        filename: message.content.url?.split('/').pop(),
                        caption: message.content.text
                    }
                });
            } else if (message.content.type === MessageContentType.image) {
                response = await this.wabaClient.sendMessage({
                    to: message.to.externalId,
                    type: 'image',
                    image: {
                        link: message.content.url,
                        caption: message.content.text
                    }
                });
            } else if (message.content.type === MessageContentType.video) {
                response = await this.wabaClient.sendMessage({
                    to: message.to.externalId,
                    type: 'video',
                    video: {
                        link: message.content.url,
                        caption: message.content.text
                    }
                });
            }

            if (!response?.messages?.[0]?.id) {
                return {
                    ...message,
                    status: Status.failed,
                    externalMetaData: {
                        whatsapp: {
                            error: 'Failed to send message',
                            timestamp: new Date().toISOString(),
                            phoneNumberId: this.phoneId,
                            accountId: this.accountId
                        }
                    }
                };
            }

            return {
                ...message,
                status: Status.sent,
                externalId: response.messages[0].id,
                externalMetaData: {
                    whatsapp: response
                }
            };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
            logger.error('Error sending WhatsApp message: %o', error);
            
            // Properly parse and store the structured error object
            const errorData: Record<string, string> = {
                error: error.message ?? error.response?.data?.error ?? error.response?.data?.error_user_msg ?? error.response?.data?.error_user_title ?? error.response?.data?.error_subcode ?? error.response?.data?.code ?? 'Unknown error',
                timestamp: new Date().toISOString(),
                phoneNumberId: this.phoneId,
                accountId: this.accountId
            };
            
            if (typeof error === 'object' && error !== null) {
                // For non-axios errors that might still be objects
                // Copy all properties from the error object that are safe to serialize
                Object.keys(error).forEach(key => {
                    // Skip circular references or non-serializable data
                    if (key !== 'toJSON' && key !== 'toString' && typeof error[key] !== 'function') {
                        try {
                            // Test if the property is JSON-serializable
                            JSON.stringify(error[key]);
                            errorData[key] = error[key];
                        } catch {
                            // If not serializable, convert to string
                            errorData[key] = String(error[key]);
                        }
                    }
                });
            }
            
            return {
                ...message,
                status: Status.failed,
                externalMetaData: {
                    whatsapp: errorData
                }
            };
        }
    }

    public listOrgEndpoints(): Endpoint[] {
        if (!this.endpoint) {
            return [];
        }
        return [this.endpoint];
    }

    public async updateStatus(message: IMessage): Promise<{ success: boolean; errorMessage?: string }> {
        try {
            if (!this.wabaClient) {
                return { success: false, errorMessage: 'WhatsApp client not initialized' };
            }

            if (!message.externalId) {
                return { success: false, errorMessage: 'Message externalId is required to update status' };
            }

            const status = await this.wabaClient.markMessageAsRead(message.externalId);
            return { success: status.success };
        } catch (error) {
            logger.error('Error updating WhatsApp message status: %o', error);
            return { 
                success: false, 
                errorMessage: error instanceof Error ? error.message : 'Unknown error occurred' 
            };
        }
    }

    /**
     * Cleans up resources and unregisters from the webhook handler
     */
    public async cleanup(): Promise<void> {
        try {
            // Unregister from webhook handler
            const webhookHandler = WhatsAppWebhookHandler.getInstance();
            webhookHandler.unregisterCallback(this.phoneId, this.orgId);
            logger.info('WhatsApp service cleaned up for phone number: %s', this.phoneNumber);
        } catch (error) {
            logger.error('Error cleaning up WhatsApp service:', error);
        }
    }
}