import { IMessagingService } from './iMessagingService';
import { IMessage, Status, Channel, Endpoint, MessageContentType } from '../../types/commTypes';
import { MessageProcessor } from './messageProcessor';
import axios from 'axios';
import logger from '../../common/logger';
import EndpointModel from '../../models/endpoint';

export class InstagramService implements IMessagingService {
    private messageProcessor: MessageProcessor;
    private authToken: string;
    private accountId: string;
    private orgId: string;
    private endpoint: Endpoint | undefined;
    public id: string;

    constructor(
        processor: MessageProcessor,
        config: { authToken: string; accountId: string },
        orgId: string
    ) {
        this.messageProcessor = processor;
        this.authToken = config.authToken;
        this.accountId = config.accountId;
        this.orgId = orgId;
        this.id = config.accountId;
    }

    public async initialize(): Promise<void> {
        try {
            this.endpoint = await EndpointModel.findOrCreateByExternalId(
                this.orgId, 
                this.accountId, 
                Channel.instagram, 
                'Instagram', 
                {
                    accountId: this.accountId,
                }
            );

            this.id = this.endpoint.id;
            logger.info('Instagram service initialized successfully for org %s', this.orgId);
        } catch (error) {
            logger.error('Error initializing Instagram service for org %s: %o', this.orgId, error);
            throw error;
        }
    }

    // public async handleWebhookMessage(payload: string, contact: string, metadata?: string): Promise<void> {
        // try {
        //     const messages = payload.entry[0]?.messaging;
        //     if (!messages) {
        //         logger.warn('No messages found in payload: %o', payload);
        //         return;
        //     }

        //     for (const message of messages) {
        //         // Process each message
        //         await this.processInstagramMessage(message);
        //     }
        // } catch (error) {
        //     logger.error('Error handling Instagram message: %o', error);
        //     throw error;
        // }
    // }

    public async validateMessage(message: IMessage): Promise<boolean> {
            return message.from.channel === Channel.instagram && message.to.channel === Channel.instagram &&
                   (message.content.type === MessageContentType.text || 
                    message.content.type === MessageContentType.template ||
                    message.content.type === MessageContentType.pdf ||
                    message.content.type === MessageContentType.image ||
                    message.content.type === MessageContentType.video);
        }

    // private async processInstagramMessage(message: any): Promise<void> {
    //     try {
    //         const instagramMessage = {
    //             channel: Channel.instagram,
    //             status: Status.received,
    //             externalId: message.message_id,
    //             externalMetaData: {
    //                 instagramSenderId: message.sender.id,
    //                 instagramRecipientId: message.recipient.id,
    //             },
    //             from: {
    //                 id: message.sender.id,
    //                 name: message.sender.name || 'Unknown',
    //             },
    //             to: {
    //                 id: message.recipient.id,
    //             },
    //             content: message.text || 'No content',
    //         };

    //         await this.processor.handleMessage(instagramMessage, { orgId: this.orgId });
    //     } catch (error) {
    //         logger.error('Error processing Instagram message: %o', error);
    //         throw error;
    //     }
    // }


    public async sendMessage(message: IMessage): Promise<IMessage> {
        try {
            const url = `https://graph.facebook.com/v11.0/${this.accountId}/messages`;

            const response = await axios.post(
                url,
                {
                    recipient: { id: message.to.id },
                    message: { text: message.content },
                },
                {
                    headers: {
                        Authorization: `Bearer ${this.authToken}`,
                    },
                }
            );

            if (response.status === 200) {
                logger.info('Successfully sent Instagram message');
                return {
                    ...message,
                    status: Status.sent,
                };
            } else {
                logger.warn('Failed to send Instagram message');
                return {
                    ...message,
                    status: Status.failed,
                    externalMetaData: {
                        error: 'Failed to send message',
                    },
                };
            }
        } catch (error) {
            logger.error('Error sending Instagram message: %o', error);
            return {
                ...message,
                status: Status.failed,
                externalMetaData: {
                    error: error instanceof Error ? error.message : 'Unknown error',
                },
            };
        }
    }


    public listOrgEndpoints(): Endpoint[] {
        return [
            {
                id: this.accountId,
                externalId: this.accountId,
                channel: Channel.instagram,
                displayName: 'Instagram',
            },
        ];
    }

    public async updateStatus(message: IMessage): Promise<{ success: boolean; errorMessage?: string }> {
        try {
            if (!message.externalId) {
                return { success: false, errorMessage: 'Message externalId is required to update status' };
            }

            const url = `https://graph.facebook.com/v11.0/${message.externalId}`;
            const response = await axios.get(url, {
                headers: {
                    Authorization: `Bearer ${this.authToken}`,
                },
            });

            if (response.status === 200) {
                return { success: true };
            } else {
                return { success: false, errorMessage: 'Failed to get Instagram message status' };
            }
        } catch (error) {
            logger.error('Error updating Instagram message status: %o', error);
            return { 
                success: false, 
                errorMessage: error instanceof Error ? error.message : 'Unknown error occurred' 
            };
        }
    }
}
