import { WebhookClient, WebhookContact, WebhookMessage, WebhookMetadata, WebhookStatus, WebhookClientArgs } from 'whatsapp-business';
import logger from '../../common/logger';
import Message from '../../models/message';
import { app } from '../../app';

type WhatsAppWebhookCallback = {
    phoneId: string;
    accountId: string;
    orgId: string;
    handleMessage: (payload: WebhookMessage, contact: WebhookContact, metadata?: WebhookMetadata) => Promise<void>;
    handleStatus: (status: WebhookStatus) => Promise<void>;
};

export class WhatsAppWebhookHandler {
    private static instance: WhatsAppWebhookHandler;
    private webhookClient: WebhookClient;
    // Map of phoneId -> callback
    private callbacksByPhoneId: Map<string, WhatsAppWebhookCallback> = new Map();
    // Map of orgId -> Set of callbacks for supporting multiple WhatsApp services per org
    private callbacksByOrgId: Map<string, Set<WhatsAppWebhookCallback>> = new Map();

    private constructor() {
        const WEBHOOK_PATH = '/webhooks/whatsapp';
        const VERIFY_TOKEN = "CleopatraIsNotYazz";
        
        const config: WebhookClientArgs = {
            token: VERIFY_TOKEN,
            path: WEBHOOK_PATH,
            expressApp: {
                shouldStartListening: false,
                app: app,
            },
        };
        
        logger.info(`Initializing WhatsApp webhook handler with path: ${WEBHOOK_PATH}`);
        this.webhookClient = new WebhookClient(config);

        this.initializeWebhookHandlers();
    }

    public static getInstance(): WhatsAppWebhookHandler {
        if (!WhatsAppWebhookHandler.instance) {
            WhatsAppWebhookHandler.instance = new WhatsAppWebhookHandler();
        }
        return WhatsAppWebhookHandler.instance;
    }

    public registerCallback(callback: WhatsAppWebhookCallback): void {
        // Store by phoneId for message handling
        this.callbacksByPhoneId.set(callback.phoneId, callback);
        
        // Store by orgId for status handling (supporting multiple services per org)
        if (!this.callbacksByOrgId.has(callback.orgId)) {
            this.callbacksByOrgId.set(callback.orgId, new Set());
        }
        this.callbacksByOrgId.get(callback.orgId)?.add(callback);
        
        logger.info(`Registered WhatsApp webhook callback for phone ID: ${callback.phoneId} in org: ${callback.orgId}`);
    }

    public unregisterCallback(phoneId: string, orgId: string): void {
        // Remove from phoneId map
        const callback = this.callbacksByPhoneId.get(phoneId);
        this.callbacksByPhoneId.delete(phoneId);
        
        // Remove from orgId map
        if (callback && this.callbacksByOrgId.has(orgId)) {
            const callbacks = this.callbacksByOrgId.get(orgId);
            callbacks?.delete(callback);
            
            // Clean up empty sets
            if (callbacks?.size === 0) {
                this.callbacksByOrgId.delete(orgId);
            }
        }
        
        logger.info(`Unregistered WhatsApp webhook callback for phone ID: ${phoneId} in org: ${orgId}`);
    }

    private initializeWebhookHandlers(): void {
        this.webhookClient.initWebhook({
            onMessageReceived: async (payload: WebhookMessage, contact: WebhookContact, metadata?: WebhookMetadata) => {
                logger.info('Received WhatsApp webhook message: %o',{payload, contact, metadata});
                try {
                    if (!metadata?.phone_number_id) {
                        logger.warn('Received WhatsApp webhook without phone number ID');
                        return;
                    }

                    const callback = this.callbacksByPhoneId.get(metadata.phone_number_id);
                    if (!callback) {
                        logger.warn(`No callback registered for WhatsApp phone ID: ${metadata.phone_number_id}`);
                        return;
                    }

                    await callback.handleMessage(payload, contact, metadata);
                } catch (error) {
                    logger.error('Error handling WhatsApp webhook message:', error);
                }
            },
            onStatusReceived: async (status: WebhookStatus) => {
                logger.info('Received WhatsApp webhook status: %o',{status});
                try {
                    // Find the message by external ID
                    const message = await Message.findOne({
                        where: { externalId: status.id }
                    });

                    if (!message) {
                        logger.warn(`Message not found for status update: ${status.id}`);
                        return;
                    }

                    // Get all callbacks for this org
                    const callbacks = this.callbacksByOrgId.get(message.orgId);
                    if (!callbacks || callbacks.size === 0) {
                        logger.warn(`No callbacks registered for org ID: ${message.orgId}`);
                        return;
                    }

                    // Try each callback until one succeeds or all fail
                    let handled = false;
                    for (const callback of callbacks) {
                        try {
                            await callback.handleStatus(status);
                            handled = true;
                            break; // Stop after first successful handler
                        } catch (error) {
                            logger.warn(`Callback for phoneId ${callback.phoneId} failed to handle status: ${error}`);
                        }
                    }

                    if (!handled) {
                        logger.warn(`No callback could handle status update for message ID: ${status.id}`);
                    }
                } catch (error) {
                    logger.error('Error handling WhatsApp webhook status:', error);
                }
            },
            onStartListening: () => {
                logger.info('WhatsApp webhook client is listening');
            },
            onError: (error) => {
                logger.error('Error handling WhatsApp webhook status error:', error);
            }
        });
        logger.info('WhatsApp webhook client initialized successfully');
    }
} 