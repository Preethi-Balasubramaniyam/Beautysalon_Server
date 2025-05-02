import { Express } from 'express';
import sequelize from './models/database';
import logger from './common/logger';
import { MessageServicesManager } from './services/messaging/messageServiceManager';
import config from 'config';
import { config as envConfig } from 'dotenv';
import { createServer } from 'http';
import { app } from './app';
import { ZohoQueueProcessor } from './zohoServices/zohoQueueProcessor';
import Org from './models/org';
import socketServer from './services/socketServer';
import { WhatsAppWebhookHandler } from './services/messaging/whatsappWebhookHandler';

// Load environment variables
envConfig();

export async function initializeServer(
    app: Express
): Promise<void> {
    try {
        logger.info('Initializing server');
        
        // Sync database
        try {
            await sequelize.sync();
            logger.info('Database synced successfully');
        } catch (error) {
            logger.error('Failed to sync database:', error);
            throw error;
        }
        
        // Initialize webhook handler before messaging services
        try {
            WhatsAppWebhookHandler.getInstance();
            logger.info('WhatsApp webhook handler initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize WhatsApp webhook handler:', error);
            throw error;
        }
        
        try {
            const booksSync = config.get('booksSync');
            if (booksSync) {
                const orgs = await Org.getAllOrgConfigs();
                for (const [orgId, orgConfig] of orgs) {
                    if (orgConfig.zoho) {
                        logger.info(`Starting queue processor for org: ${orgId}`);  
                        const processor = new ZohoQueueProcessor(orgId);
                        processor.startQueueProcessor();
                    } else {
                        logger.info(`Zoho configuration not found for org: ${orgId}. Skipping queue processor`);
                    } 
                }
            }
        } catch (error) {
            logger.error('Failed to initialize Zoho queue processors:', error);
            // Continue initialization - non-critical error
        }

        // Start HTTP server
        try {
            const httpServer = createServer(app);
            socketServer.initialize(httpServer);
            logger.info('Socket service initialized successfully');
            const httpPort: number = config.get('server.http_port') || 8080;
            httpServer.listen(httpPort, () => {
                logger.info(`HTTP server is running on port ${httpPort}`);
            });
        } catch (error) {
            logger.error('Failed to start HTTP server:', error);
            throw error; // Critical error
        }

        // Start WebSocket server
        try {
            await socketServer.start();
            logger.info('WebSocket server started successfully');
        } catch (error) {
            logger.error('Failed to start WebSocket server:', error);
            throw error; // Critical error
        }

        // Initialize messaging services
        try {
            await MessageServicesManager.initializeMessagingServices();
            logger.info('Messaging services initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize messaging services:', error);
            throw error;
        }


    } catch (error) {
        logger.error('Failed to initialize server:', error);
        throw error;
    }
} 

async function startServer() {
    try {
        // Add global unhandled error handlers
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught exception:', error);
            console.log('Uncaught exception:', error);
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled rejection at:', promise, 'reason:', reason);
            console.log('Unhandled rejection at:', promise, 'reason:', reason);
        });
        
        await initializeServer(app);
        logger.info('Server initialized successfully');
    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();


