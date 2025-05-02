import Queue from '../models/queue';
import { Queue as QueueInterface } from '../types/queueTypes';
import { Op, Transaction } from 'sequelize';
import { ZohoContactService } from './zohoContactService';
import { ZohoItemService } from './zohoItemService';
import { ZohoBranchService } from './zohoBranchService';
import { ZohoSalespersonService } from './zohoSalespersonService'; // Import BooksServiceProviderData
import { ZohoInvoiceService } from './zohoInvoiceService'; // Import BooksInvoiceData
import { queueLogger } from '../common/logger'; // Import queueLogger
import { ZohoLedgerService } from './zohoLedgerService'; // Import BooksAccountData
import { Logger } from 'winston';
import sequelize from '../models/database';
import { Module } from '../types/queueTypes'; // Import Module enum

export class ZohoQueueProcessor {
    private booksCustomerData: ZohoContactService;
    private booksItemsData: ZohoItemService;
    private booksServiceProviderData: ZohoSalespersonService; // Add BooksServiceProviderData
    private booksInvoiceData: ZohoInvoiceService; // Add BooksInvoiceData
    private booksBranchData: ZohoBranchService;
    private booksAccountData: ZohoLedgerService; // Add BooksAccountData
    private orgId: string;

    //TODO: We need to divide zoho processing by org

    constructor(orgId: string, logger: Logger | undefined = undefined) {
        if (!logger) {
            logger = queueLogger;
        }
        this.booksItemsData = new ZohoItemService(logger, orgId);
        this.booksCustomerData = new ZohoContactService(logger, orgId);
        this.booksServiceProviderData = new ZohoSalespersonService(logger, orgId); // Initialize BooksServiceProviderData
        this.booksInvoiceData = new ZohoInvoiceService(logger, orgId); // Initialize BooksInvoiceData
        this.booksBranchData = new ZohoBranchService(logger, orgId);
        this.booksAccountData = new ZohoLedgerService(logger, orgId); // Initialize BooksAccountData
        this.orgId = orgId;
    }

    public async processQueueItem(item: QueueInterface): Promise<QueueInterface> {
        // Ensure the item is not complete before starting processing
        queueLogger.info(`Processing item with id: ${item.id} and module: ${item.module}`);
        let output;
        switch (item.module) {
            case Module.Account:
                output = await this.booksAccountData.processQueueItem(item);
                break;
            case Module.Branch:
                output = await this.booksBranchData.processQueueItem(item);
                break;
            case Module.ServiceProvider:
                output = await this.booksServiceProviderData.processQueueItem(item);
                break;
            case Module.Customer:
                output = await this.booksCustomerData.processQueueItem(item);
                break;
            case Module.Item:
                output = await this.booksItemsData.processQueueItem(item);
                break;
            case Module.Invoice:
                output = await this.booksInvoiceData.processQueueItem(item);
                break;
            default:
                throw new Error(`Unknown module: ${item.module}`);
                break;
        }
        queueLogger.info(`Successfully processed item with id: ${item.id}`);
        return output;
    }

    public async processQueue(): Promise<void> {
        queueLogger.info('Starting to process queue');
        const queueItems = await Queue.findAll({ where: { status: { [Op.notIn]: ['error', 'complete'] }, orgId: this.orgId } });

        const moduleOrder = ['Account', 'Branch', 'ServiceProvider', 'Customer', 'Item', 'Invoice'];
        queueItems.sort((a, b) => moduleOrder.indexOf(a.module) - moduleOrder.indexOf(b.module));

        const processedItems = new Set();

        for (const item of queueItems) {
            const uniqueKey = `${item.entityId}-${item.action}`;
            if (processedItems.has(uniqueKey)) {
                await Queue.update({ status: 'complete', processCount: item.processCount - 1 }, { where: { id: item.id } });
                continue;
            }
            processedItems.add(uniqueKey);

            try {
                await sequelize.transaction(async (transaction) => {
                    // Lock the row before processing
                    const lockedItem = await Queue.findOne({ where: { id: item.id }, lock: Transaction.LOCK.UPDATE, transaction });

                    if (lockedItem && lockedItem.status !== 'complete' && lockedItem.status !== 'error') {
                        const queueOut = await this.processQueueItem(item);
                        await Queue.update({ status: 'complete', metaData : queueOut.metaData }, { where: { id: item.id }, transaction });
                    } else {
                        queueLogger.info(`Skipping item with id: ${item.id} as it is already complete`);
                    }
                });
            } catch (error) {
                queueLogger.error(`Error processing queue item with id: ${item.id}`, error);
                item.processCount += 1;
                if (item.processCount > 3) {
                    await Queue.update({ status: 'error', metaData: error }, { where: { id: item.id } });
                } else {
                    await item.save();
                }
            }
        }
        queueLogger.info('Finished processing queue');
    }

    public startQueueProcessor(interval: number = 60000): void { //Once in a minute
        queueLogger.info(`Starting queue processor with interval: ${interval}ms`);
        setInterval(async () => {
            try {
                await this.processQueue();
            } catch (error) {
                queueLogger.error('Error processing queue:', error);
            }
        }, interval);
    }

    // Add static queue methods for ServiceProvider
    public static async queueCreateOrUpdateItem(logger: Logger, orgId: string, entityId: string, module: Module, params: any): Promise<void> {
        try {
            logger.info(`Queueing create/update for service provider: ${params.mobile}`);
            await Queue.create({ params, entityId, action: 'createOrUpdate', module, orgId });
        } catch (error) {
            logger.error(`Error queuing service provider create/update: ${params.mobile}`, error);
        }
    }

    public static async queueDeleteItem(logger: Logger, booksRefId: string, module: Module): Promise<void> {
        // TODO: Implement this method if required
    }
}