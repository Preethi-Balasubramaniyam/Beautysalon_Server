import { Logger } from 'winston';
import { ZohoBooksClient } from './zohoBooksClient';
import { Queue } from '../types/queueTypes';
import { SaleItem } from '../types/saleItemTypes';
import DBSaleItem from '../models/saleItem';

export type BooksItem = Pick<SaleItem, 'name' | 'rate' | 'category' | 'booksRefId'>;

export class ZohoItemService {
    private logger: Logger;
    private orgId: string;

    constructor(logger: Logger, orgId: string) {
        this.logger = logger;
        this.orgId = orgId;
    }

    public async getItemByName(name: string): Promise<BooksItem | null> {
        this.logger.info(`getItemByName called with name: ${name}`);
        try {
            this.logger.info(`Fetching item data for name: ${name}`);
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
            const response = await client.getRecords('items', { name_contains: name });
            this.logger.info(`Fetched item data for name: ${name} %o`, response);
            if (response.items.length === 0) {
                this.logger.warn(`No item found with name: ${name}`);
                this.logger.warn('No Item Found with Name ' + name);
                return null;
            }
            for (const item of response.items) {
                if (item.name !== name) { //Zoho Returns partially matching names
                    this.logger.warn(`Item name does not match: ${item.name}. Not Expected: %o`, response.items);
                    continue;
                }
                if (item.status === 'active' || response.items.indexOf(item) === response.items.length - 1) {
                    const booksItem = this.mapZohoItem2BooksItem(item);
                    this.logger.info(`Found item with name: ${name}`, booksItem);
                    this.logger.info(`Found Item with name :`, booksItem);
                    return booksItem;
                }
            }
            return null;
        } catch (error) {
            this.logger.error(`Error in getItemByName for name: ${name}`, error);
            this.logger.error(`Error fetching item for name: ${name}`, error);
            throw new Error('Error fetching customer: ' + error);
        }
    }

    public async addOrUpdateItem(params: BooksItem): Promise<BooksItem> {
        this.logger.info(`addOrUpdateItem called with params: %o`, params);
        try {
            const existingItem = await this.getItemByName(params.name);
            if (existingItem && existingItem.booksRefId) {
                params.booksRefId = existingItem.booksRefId;
                return await this.updateBooksItem(params);
            } else {
                return await this.addBooksItem(params);
            }
        } catch (error) {
            this.logger.error('Error in addOrUpdateItem', error);
            throw new Error('Error adding/updating item: ' + error);
        }
    }

    private extractNumberFromPercent(percentString: string): number {
        this.logger.info(`extractNumberFromPercent called with percentString: ${percentString}`);
        // Use a regular expression to match the number part of the string
        const match = percentString.toString().match(/(\d+(\.\d+)?)/);
        // If a match is found, parse it as a float and return it
        return match ? parseFloat(match[0]) : NaN;
    }

    private mapZohoItem2BooksItem(item: any): BooksItem {
        this.logger.info('mapZohoItem2BooksItem called with item: %o', item);
        this.logger.info('Mapping Zoho item to Books item: %o', item);
        var taxPercent = this.extractNumberFromPercent(item.tax_percentage);
        if (taxPercent == 0) {
            taxPercent = 18; //Default GST rate
        }
        const itemData: BooksItem = {
            name: item.name,
            rate: item.rate * (100+taxPercent)/100, // Zoho is storing without tax
            category: {
                type: item.product_type === 'goods' ? 'product' : 'service',
                hsnSacCode: item.hsn_or_sac,
                taxPercent: taxPercent,
                id: item.hsn_or_sac,
                name: 'Unknwn'
            },
            booksRefId: item.item_id,
        };
        return itemData;
    }

    public mapBooksItem2ZohoItem(booksItem: BooksItem): any {
        this.logger.info('mapBooksItem2ZohoItem called with booksItem: %o', booksItem);
        this.logger.info('Mapping Books item to Zoho item: %o', booksItem);
        const taxPercent:number = booksItem.category ? booksItem.category.taxPercent : 18;
        const itemWithoutTax = (booksItem.rate * 100.00) / (100.00 + taxPercent); // Zoho is storing without tax
        this.logger.info(`Item without tax: ${itemWithoutTax}`);
        const zohoItem: any = {
            name: booksItem.name,
            rate: itemWithoutTax,
            product_type: booksItem.category?.type === 'product' ? 'goods' : 'service',
            hsn_or_sac: booksItem.category?.hsnSacCode,
            tax_percentage: `${booksItem.category?.taxPercent}%`
        };

        if (booksItem.booksRefId) {
            zohoItem.item_id = booksItem.booksRefId;
        }
        return zohoItem;
    }

    public async addBooksItem(item: BooksItem): Promise<BooksItem> {
        this.logger.info(`addBooksItem called with item: %o`, item);
        try {
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
            const response = await client.addRecord('items', this.mapBooksItem2ZohoItem(item));
            item.booksRefId = response.item.item_id;
            return item;
        } catch (error) {
            this.logger.error('Error in addBooksItem', error);
            throw new Error('Error adding item: ' + error);
        }
    }

    public async updateBooksItem(item: BooksItem): Promise<BooksItem> {
        this.logger.info(`updateBooksItem called with item: %o`, item);
        try {
            if (!item.booksRefId) {
                throw new Error('booksRefID is required to update item');
            }
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
            const response = await client.updateRecord('items', item.booksRefId, this.mapBooksItem2ZohoItem(item));
            return item;
        } catch (error) {
            this.logger.error('Error in updateBooksItem', error);
            throw new Error('Error updating item: ' + error);
        }
    }

    public async fetchAllItems(page: number): Promise<{ items: BooksItem[], hasMorePages: boolean }> {
        this.logger.info(`fetchAllItems called with page: ${page}`);
        try {
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
            const response: any = await client.getRecords('items', { page });
            return {
                items: response.items.map((item: any) => this.mapZohoItem2BooksItem(item)),
                hasMorePages: response.page_context.has_more_page
            };
        } catch (error) {
            this.logger.error('Error in fetchAllItems', error);
            throw new Error('Error fetching all items: ' + error);
        }
    }

    public async processQueueItem(item : Queue): Promise<Queue> {
        this.logger.info('processQueueItem called with item: %o', item);
        if (item.action === 'createOrUpdate') {
            const rawItem = await DBSaleItem.findByPk(item.entityId, {
                include: [{ association: 'category' }]
            });
            if (!rawItem) {
                throw new Error(`SaleItem entity #${item.entityId} not found`);
            }
            const params = DBSaleItem.fromDBModel(rawItem);
            let newZohoItem;
            if (!params) {
                throw new Error(`SaleItem entity #${item.entityId} not found`);
            }
            if (params.booksRefId) {
                newZohoItem = await this.updateBooksItem(params);
            } else {
                newZohoItem = await this.addOrUpdateItem(params);
                if (newZohoItem && newZohoItem.booksRefId) {
                    await DBSaleItem.update({ booksRefId: newZohoItem.booksRefId }, { where: { id: item.entityId } });
                }
            }
            item.metaData = newZohoItem;
            return item;
        }
        throw new Error('Invalid action: ' + item.action);
    }
}