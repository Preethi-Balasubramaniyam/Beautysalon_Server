import { Logger } from 'winston';
import { ZohoBooksClient } from './zohoBooksClient';
import Customer from '../models/customer';
import { Queue } from '../types/queueTypes';
import { CustomerInput, Customer as CustomerType } from '../types/customerTypes'; // Import the types

type BooksCustomer = Pick<CustomerType, 'name' | 'email' | 'mobile' | 'city' | 'postalCode' | 'address' | 'booksRefId'>;

export class ZohoContactService {
    private logger: Logger;
    private orgId: string;

    constructor(logger: Logger, orgId: string) {
        this.logger = logger;
        this.orgId = orgId;
    }

    public async getCustomerDataByMobile(mobileNo: string): Promise<BooksCustomer | undefined> {
        try {
            this.logger.info(`Fetching customer data for mobile: ${mobileNo}`);
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
            const response = await client.getRecords('contacts', { phone: mobileNo, detailedlist: true });
            if (response.contacts.length === 0) {
                this.logger.info(`No contact found with mobile number: ${mobileNo}`);
                return undefined;
            }
            for (const contact of response.contacts) {
                if (contact.contact_persons[0].mobile !== mobileNo) {
                    this.logger.warn(`Contact mobile number does not match: ${contact.contact_persons[0].mobile}. Not Expected: %o`, response.contacts);
                    continue;
                }
                if (contact.status === 'active' || response.contacts.indexOf(contact) === response.contacts.length - 1) {
                    return this.getBooksCustomer(contact);
                }
            }
            throw new Error('No active contact found with mobile number ' + mobileNo);
        } catch (error) {
            this.logger.error(`Error fetching customer for mobile: ${mobileNo}`, error);
            throw new Error('Error fetching customer: ' + error);
        }
    }

    public async addOrUpdateCustomer(params: BooksCustomer): Promise<BooksCustomer> {
        try {
            const existingCustomer = await this.getCustomerDataByMobile(params.mobile);
            if (existingCustomer) {
                if (JSON.stringify(existingCustomer) === JSON.stringify(params)) {
                    this.logger.info(`Customer already exists with same data: ${params.mobile}`);
                    return existingCustomer;
                } else {
                    this.logger.info(`Customer already exists with different data: ${params.mobile}`);
                    params.booksRefId = existingCustomer.booksRefId;
                    return await this.updateBooksCustomer(params);
                }
            } else {
                return await this.addBooksCustomer(params);
            }
        } catch (error) {
            this.logger.error('Error adding/updating customer', error);
            throw new Error('Error adding/updating customer: ' + error);
        }
    }

    private getZohoContact(customer: BooksCustomer): any {
        const [first_name, last_name] = customer.name.split(" ");
        const contactPerson = {
            first_name : first_name,
            last_name : last_name,
            mobile : customer.mobile,
            email : customer.email
        }
        const billingAddress = {
            address : customer.address,
            zip : customer.postalCode,
            city : customer.city
        }
        const contact = {
            contact_name: customer.name + " " + customer.mobile, //Zoho contact_name needs to be unique
            contact_persons: [contactPerson],
            billing_address: billingAddress,
            contact_type: "customer",
            gst_treatment: "consumer",
            status: "active",

        };
        return contact;
    }
    private getBooksCustomer(contact: any): BooksCustomer {
        const customer: CustomerInput = {
            name: contact.contact_name,
            email: contact.contact_persons[0].email,
            mobile: contact.contact_persons[0].mobile,
            city: contact.billing_address.city,
            postalCode: contact.billing_address.zip,
            address: contact.billing_address.address,
            booksRefId: contact.contact_id,
            gender: 'u'
        };
        return customer;
    }

    public async addBooksCustomer(customer: BooksCustomer): Promise<BooksCustomer> {
        try {
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
            const response = await client.addRecord('contacts', this.getZohoContact(customer));
            customer.booksRefId = response.contact.contact_id;
            return this.getBooksCustomer(response.contact);
        } catch (error) {
            throw new Error('Error adding customer: ' + error);
        }
    }

    public async updateBooksCustomer(customer: BooksCustomer): Promise<BooksCustomer> {
        try {
            if (!customer.booksRefId) {
                throw new Error('booksRefId is required to update customer');
            }
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
            const response = await client.updateRecord('contacts', customer.booksRefId, this.getZohoContact(customer));
            return this.getBooksCustomer(response.contact);
        } catch (error) {
            this.logger.error('Error updating customer: %o', error);
            throw new Error('Error updating customer: ' + error);
        }
    }

    public async processQueueItem(item: Queue): Promise<Queue> {
        try {
            this.logger.info('Processing queue item: %o', item);
            if (item.action === 'createOrUpdate') {
                const params = await Customer.findByPk(item.entityId);
                if (!params) {
                    throw new Error(`Customer entity #${item.entityId} not found`);
                }
                const zohoOutput = params.booksRefId 
                    ? await this.updateBooksCustomer(params) 
                    : await this.addOrUpdateCustomer(params);
                if (zohoOutput && zohoOutput.booksRefId) {
                    await Customer.update({ booksRefId: zohoOutput.booksRefId }, { where: { id: item.entityId } });
                }
                item.metaData = zohoOutput;
                return item;
            }
            throw new Error('Invalid action: ' + item.action);
        } catch (error) {
            this.logger.error('Error processing queue item: %o', error);
            throw error;
        }
    }

    public async fetchAllZohoCustomers(page: Number): Promise<{customers:BooksCustomer[], hasMorePages:boolean}> {
        try {
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
            const response = await client.getRecords('contacts', { detailedlist: true, page });
            return {
                customers: response.contacts.map((contact: any) => this.getBooksCustomer(contact)),
                hasMorePages: response.page_context.has_more_page
            };
        } catch (error) {
            throw new Error('Error fetching all Zoho customers: ' + error);
        }
    }
}
