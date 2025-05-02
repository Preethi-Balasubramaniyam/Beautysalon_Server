import { ZohoBooksClient } from './zohoBooksClient';
import ServiceProvider from '../models/serviceProvider';
import { Queue } from '../types/queueTypes';
import { Logger } from 'winston';

type BooksServiceProvider = Pick<ServiceProvider, 'name' | 'mobile' | 'booksRefId'>;

export class ZohoSalespersonService {
    private logger: Logger;
    private orgId: string;

    constructor(logger: Logger, orgId: string) {
        this.logger = logger;
        this.orgId = orgId;
    }

    public async getServiceProviderDataByMobile(mobile: string): Promise<BooksServiceProvider | undefined> {
        try {
            this.logger.info(`Fetching service provider data for mobile: ${mobile}`);
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
            const email = this.getZohoServiceProvider({ name: '', mobile, booksRefId: '' }).salesperson_email;
            const response = await client.getRecords('salespersons', { salesperson_email: email});
            this.logger.info(`Fetched service provider data for mobile: ${mobile}: %o`, response);
            if (!response.data || response.data.length === 0) {
                this.logger.warn(`No contact found with mobile number: ${mobile}`);
                return undefined;
            }
            let serviceProviderContact = response.data.find((contact: any) => contact.salesperson_email === email);
            if (!serviceProviderContact) {
                this.logger.warn(`No contact found with mobile number: ${mobile}`);
                return undefined;
            }
            const serviceProvider = this.getBooksServiceProvider(serviceProviderContact);
            this.logger.info(`Found service provider with mobile number: ${mobile}: %o`, serviceProvider);
            return serviceProvider;
        } catch (error) {
            this.logger.error(`Error fetching service provider for mobile: ${mobile}`, error);
            throw new Error('Error fetching service provider: ' + error);
        }
    }

    public async addOrUpdateServiceProvider(params: BooksServiceProvider): Promise<BooksServiceProvider> {
        try {
            this.logger.info(`Adding or updating service provider: ${params.mobile}`);
            const existingServiceProvider = await this.getServiceProviderDataByMobile(params.mobile);
            if (existingServiceProvider && existingServiceProvider.booksRefId) {
                params.booksRefId = existingServiceProvider.booksRefId;
                return await this.updateBooksServiceProvider(params);
            } else {
                return await this.addBooksServiceProvider(params);
            }
        } catch (error) {
            this.logger.error(`Error adding/updating service provider: ${params.mobile} %j`, error);
            throw new Error('Error adding/updating service provider: ' + error);
        }
    }

    private getZohoServiceProvider(serviceProvider: BooksServiceProvider): any {
        const sanitizedMobile = serviceProvider.mobile.replace(/\+/g, '');
        return {
            salesperson_name: serviceProvider.name + ':' + sanitizedMobile,
            salesperson_email: sanitizedMobile + '@phone.com',
            ...(serviceProvider.booksRefId && { salesperson_id: serviceProvider.booksRefId })
        };
    }

    private getBooksServiceProvider(contact: any): BooksServiceProvider {
        const serviceProvider: BooksServiceProvider = {
            name: contact.salesperson_name.split(':')[0],
            mobile: '+' + contact.salesperson_email.split('@')[0],
            booksRefId: contact.salesperson_id,
        };
        return serviceProvider;
    }

    public async addBooksServiceProvider(serviceProvider: BooksServiceProvider): Promise<BooksServiceProvider> {
        try {
            this.logger.info(`Adding new service provider: ${serviceProvider.mobile}`);
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
            const response = await client.addRecord('salespersons', this.getZohoServiceProvider(serviceProvider));
            this.logger.info(`Added new service provider: ${serviceProvider.mobile} with response %j`, response);
            serviceProvider.booksRefId = response.salespersons.salesperson_id;
            this.logger.info(`Added new service provider with booksRefId: ${serviceProvider.booksRefId}`);
            return serviceProvider;
        } catch (error) {
            this.logger.error(`Error adding service provider: ${serviceProvider.mobile}`, error);
            throw new Error('Error adding service provider: ' + error);
        }
    }

    public async updateBooksServiceProvider(serviceProvider: BooksServiceProvider): Promise<BooksServiceProvider> {
        try {
            if (!serviceProvider.booksRefId) {
                throw new Error('booksRefId is required to update service provider');
            }
            this.logger.info(`Updating service provider: ${serviceProvider.mobile}`);
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
            const response = await client.updateRecord('salespersons', serviceProvider.booksRefId, this.getZohoServiceProvider(serviceProvider));
            this.logger.info(`Updated service provider with booksRefId: ${serviceProvider.booksRefId}`);
            return serviceProvider;
        } catch (error) {
            this.logger.error(`Error updating service provider: ${serviceProvider.mobile}`, error);
            throw new Error('Error updating service provider: ' + error);
        }
    }

    public async processQueueItem(item: Queue): Promise<Queue> {
        this.logger.info('Processing queue item:', item);
        if (item.action === 'createOrUpdate') {
            const params = await ServiceProvider.findByPk(item.entityId);
            if (!params) {
                this.logger.error(`ServiceProvider entity #${item.entityId} not found`);
                throw new Error(`ServiceProvider entity #${item.entityId} not found`);
            }
            this.logger.info('Processing createOrUpdate service provider:', params);
            let newZohoServiceProvider;
            if (params.booksRefId && params.booksRefId !== '') {
                newZohoServiceProvider = await this.updateBooksServiceProvider(params);
            } else {
                newZohoServiceProvider = await this.addOrUpdateServiceProvider(params);
                if (newZohoServiceProvider && newZohoServiceProvider.booksRefId) {
                    await ServiceProvider.update({ booksRefId: newZohoServiceProvider.booksRefId }, { where: { id: item.entityId } });
                }
            }
            item.metaData = newZohoServiceProvider;
            return item;
        }
        throw new Error('Invalid action: ' + item.action);
    }
}