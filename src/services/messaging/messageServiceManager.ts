import { Channel } from '../../types/commTypes';
import { WhatsAppService } from './whatsappMessagingService';
import { InstagramService } from './instagramMessagingService';
import { SocketMessageService } from './socketMessagingService';
import { OrgConfiguration, SocketConfiguration, WhatsappConfiguration } from '../../types/orgTypes';
import Org from '../../models/org';
import logger from '../../common/logger';
import { MessageProcessor } from './messageProcessor';

export class MessageServicesManager {
    private static instance: MessageServicesManager;
    private messageProcessors: Map<string, MessageProcessor> = new Map();

    private constructor() {}

    public static getInstance(): MessageServicesManager {
        if (!MessageServicesManager.instance) {
            MessageServicesManager.instance = new MessageServicesManager();
        }
        return MessageServicesManager.instance;
    }

    private async initializeWhatsAppServices(
        processor: MessageProcessor, 
        whatsappConfig: WhatsappConfiguration, 
        orgId: string
    ): Promise<void> {
        if (whatsappConfig?.phoneconfig?.length) {
            for (const phoneConfig of whatsappConfig.phoneconfig) {
                const whatsappService = new WhatsAppService(processor, {
                    authToken: phoneConfig.authToken,
                    phoneNumber: phoneConfig.phoneNumber,
                    accountId: phoneConfig.accountId,
                    phoneId: phoneConfig.phoneId
                }, orgId);
                await whatsappService.initialize();
                processor.addMessagingService(Channel.whatsapp, whatsappService);
                logger.info(`Added WhatsApp service to message processor for phone number ${phoneConfig.phoneNumber} in org ${orgId}`);
            }
        }
    }

    private async initializeInstagramService(
        processor: MessageProcessor,
        instagramConfig: { authToken: string; businessAccountId: string },
        orgId: string
    ): Promise<void> {
        if (instagramConfig?.authToken && instagramConfig?.businessAccountId) {
            const instagramService = new InstagramService(
                processor,
                {
                    authToken: instagramConfig.authToken,
                    accountId: instagramConfig.businessAccountId,
                },
                orgId
            );
            await instagramService.initialize();
            processor.addMessagingService(Channel.instagram, instagramService);
            logger.info(
                `Added Instagram service to message processor for business account ID ${instagramConfig.businessAccountId} in org ${orgId}`
            );
        }
    }

    private async initializeProcessor(orgId: string, configuration: OrgConfiguration): Promise<MessageProcessor> {
        const messageProcessor = new MessageProcessor(orgId);
        this.messageProcessors.set(orgId, messageProcessor);
        
        // Initialize WhatsApp services
        const whatsappConfig = configuration.whatsapp as WhatsappConfiguration;
        await this.initializeWhatsAppServices(messageProcessor, whatsappConfig, orgId);

        // Initialize Instagram services
        const instagramConfig = configuration.instagram as {
            authToken: string;
            businessAccountId: string;
        };
        await this.initializeInstagramService(messageProcessor, instagramConfig, orgId);

        // Initialize Socket service for the organization
        const socketConfig = configuration.socket as SocketConfiguration;
        if (!socketConfig?.disabled) {
            const socketService = new SocketMessageService(messageProcessor, orgId, socketConfig?.endpoints || []);
            try {
                await socketService.initialize();
                messageProcessor.addMessagingService(Channel.app, socketService);
                logger.info(`Initialized Socket service for organization ${orgId}`);
            } catch (error) {
                logger.error(`Failed to initialize Socket service for organization ${orgId}:`, error);
            }
        }
        messageProcessor.startProcessing();
        return messageProcessor;
    }

    public async getMessageProcessor(orgId: string): Promise<MessageProcessor> {
        if (!this.messageProcessors.has(orgId)) {
            const orgConfig = await Org.getConfiguration(orgId);
            if (!orgConfig) {
                throw new Error(`Organization ${orgId} not found`);
            }
            return await this.initializeProcessor(orgId, orgConfig);
        }
        return this.messageProcessors.get(orgId)!;
    }

    public stopAllProcessors(): void {
        for (const processor of this.messageProcessors.values()) {
            processor.stopProcessing();
        }
    }

    public static async initializeMessagingServices(): Promise<void> {
        try {
            const manager = MessageServicesManager.getInstance();
            
            // Get all organization configurations
            const orgConfigs = await Org.getAllOrgConfigs();

            manager.messageProcessors = new Map();
            for (const [orgId, configuration] of orgConfigs) {
                const messageProcessor = await manager.initializeProcessor(orgId, configuration);
                manager.messageProcessors.set(orgId, messageProcessor);
            }

            logger.info(`Scheduled message processor to run every 15 minutes`);
        } catch (error) {
            logger.error('Error initializing messaging services:', error);
            throw error;
        }
    }

    public async refreshOrgServices(orgId: string): Promise<void> {
        try {
            const processor = this.messageProcessors.get(orgId);
            if (!processor) {
                throw new Error(`No message processor found for organization ${orgId}`);
            }

            // Get the latest configuration
            const orgConfig = await Org.getConfiguration(orgId);
            if (!orgConfig) {
                throw new Error(`Organization ${orgId} not found`);
            }

            // Remove existing WhatsApp service
            processor.removeMessagingService(Channel.whatsapp);

            // Initialize new WhatsApp services from the latest configuration
            const whatsappConfig = orgConfig.whatsapp as WhatsappConfiguration;
            await this.initializeWhatsAppServices(processor, whatsappConfig, orgId);

            // Remove existing Instagram service
            processor.removeMessagingService(Channel.instagram);

            // Initialize new Instagram service from the latest configuration
            const instagramConfig = orgConfig.instagram as {
                authToken: string;
                businessAccountId: string;
            };
            await this.initializeInstagramService(processor, instagramConfig, orgId);

            logger.info(`Successfully refreshed messaging services for organization ${orgId}`);
        } catch (error) {
            logger.error(`Error refreshing messaging services for organization ${orgId}:`, error);
            throw error;
        }
    }
} 