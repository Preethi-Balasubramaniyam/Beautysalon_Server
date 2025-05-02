import { Queue } from '../types/queueTypes';
import { Logger } from 'winston';
import DBInvoice from '../models/invoice';
import { Invoice, PaymentMode, InvoiceSaleItem, CustomerPayment } from '../types/invoiceTypes';
import DBCustomerPayment from '../models/customerPayment';
import DBInvoiceSaleItem from '../models/invoiceSaleItem';
import { ZohoBooksClient } from './zohoBooksClient'; // Add this line to import ZohoBooksClient
import { Customer } from '../types/customerTypes';
import { ServiceProvider } from '../types/serviceProviderTypes';
import { Branch } from '../types/branchTypes';
import Ledger from '../models/ledger'; // Add this line to import Account

type BooksInvoiceSaleItem = Pick<InvoiceSaleItem, 'itemId' | 'rate' | 'quantity' | 'booksRefId'>;
type BooksCustomerPayment = Pick<CustomerPayment, 'id' | 'paymentMode' | 'amount' | 'date' | 'booksRefId'>;
type BooksInvoice = Pick<Invoice, 'id' | 'customerInvoiceNumber' |'booksRefId' | 'date' | 'total' | 'payments' | 'invoiceSaleItems' | 'customer' | 'serviceProvider' | 'branch' | 'discounts' | 'roundOff' | 'metaData'>;

export class ZohoInvoiceService {
    private logger: Logger;
    private orgId: string;

    constructor(logger: Logger, orgId: string) {
        this.logger = logger;
        this.orgId = orgId;
    }

    private getZohoInvoice(invoice: BooksInvoice): any {
        const zohoInvoice: any = {
            date: invoice.date,
            customer_id: invoice.customer?.booksRefId,
            line_items: invoice.invoiceSaleItems.map((item: BooksInvoiceSaleItem) => ({
                item_id: item.booksRefId,
                rate: item.rate,
                quantity: item.quantity
            })),
            total: invoice.total,
            is_inclusive_tax: true,
            branch_id: invoice.branch?.booksRefId,
            salesperson_id: invoice.serviceProvider?.booksRefId,
            gst_treatment: 'consumer',
            reference_number: invoice.id,
        };

        let discount;
        if (invoice.discounts && invoice.discounts.length >= 1) {  
            let totalDiscount = invoice.discounts.reduce((sum, discount) => sum + discount.value, 0);
            if (invoice.discounts[0].type === 'percentage') {
                discount = `${totalDiscount}%`;
            } else {    
                discount = totalDiscount;
            }
            this.logger.info('Discount found %o', { discount });
        } else {
            this.logger.info('No discount found');
        }

        if (discount) {
            if (typeof discount === 'number' && discount < 0) {
                if (invoice.roundOff && invoice.roundOff != 0.0) {
                    throw new Error('Round off and discount cannot be applied together');
                }
                zohoInvoice.adjustment = -discount;
                zohoInvoice.adjustment_description = 'Round off';
                zohoInvoice.discount = 0;
            } else {
                zohoInvoice.discount = discount;
                zohoInvoice.discount_type = 'entity_level';
                zohoInvoice.is_discount_before_tax = false;
            }
        } else {
            zohoInvoice.discount = 0;
        }

        if (!zohoInvoice.adjustment) {
            zohoInvoice.adjustment = invoice.roundOff || 0;
            zohoInvoice.adjustment_description = invoice.roundOff && invoice.roundOff != 0.0 ? 'Round off' : undefined;
        }

        return zohoInvoice;
    }

    private mapFromZohoInvoice(zohoInvoice: any): BooksInvoice {
        const invoice: BooksInvoice = {
            id: zohoInvoice.reference_number,
            customerInvoiceNumber: zohoInvoice.invoice_number,
            booksRefId: zohoInvoice.invoice_id,
            date: zohoInvoice.date,
            total: zohoInvoice.total,
            payments: [], // You need to map payments separately
            invoiceSaleItems: zohoInvoice.line_items.map((item: any) => ({
                itemId: item.item_id,
                rate: item.rate,
                quantity: item.quantity,
                booksRefId: item.item_id
            })),
            customer: { booksRefId: zohoInvoice.customer_id } as Customer,
            serviceProvider: { booksRefId: zohoInvoice.salesperson_id } as ServiceProvider,
            branch: { booksRefId: zohoInvoice.branch_id } as Branch,
            discounts: [], // You need to map discounts separately
            roundOff: zohoInvoice.adjustment,
        };
        invoice.discounts  = [];
        if (zohoInvoice.discount) {
            invoice.discounts.push({
                type: typeof zohoInvoice.discount === 'string' && zohoInvoice.discount.includes('%') ? 'percentage' : 'amount',
                value: typeof zohoInvoice.discount === 'string' ? parseFloat(zohoInvoice.discount) : zohoInvoice.discount
            });
        }
        invoice.metaData = zohoInvoice;
        return invoice;
    }

    private async map2ZohoPayments(branch: Branch, payment: BooksCustomerPayment, cusBooksRefId: string, invoiceBooksRefId: string): Promise<any> {
        const accountId = payment.paymentMode === PaymentMode.cash ? branch.cashLedgerId : branch.bankLedgerId;
        if (!accountId) {
            throw new Error('Account Id is undefined');
        }   
        const accountBooksRefId = await Ledger.getBooksRefIdById(accountId);
        if (!accountBooksRefId) {
            throw new Error(`Ledger booksRefId is undefined for ledger with id: ${accountId}`);
        }   
        const zohoPayment = {
            customer_id: cusBooksRefId,
            invoice_id: invoiceBooksRefId,
            payment_mode: payment.paymentMode,
            amount: payment.amount,
            amount_applied: payment.amount,
            date: payment.date,
            account_id: accountBooksRefId,
            invoices: [
                {
                    invoice_id: invoiceBooksRefId,
                    amount_applied: payment.amount
                }
            ]
        };
        this.logger.debug('Zoho payment %o', { zohoPayment });
        return zohoPayment;
    }

    private map2BooksPayment(zohoPayment: any): BooksCustomerPayment {
        const payment: BooksCustomerPayment = {
            id: '',
            paymentMode: zohoPayment.payment_mode,
            amount: zohoPayment.amount,
            date: zohoPayment.date,
            booksRefId: zohoPayment.payment_id
        };
        return payment;
    }

    private async createInvoice(invoice: BooksInvoice): Promise<BooksInvoice> {
        try {
            this.logger.info('Creating invoice', { invoice });
            if (!invoice.customer || !invoice.customer.booksRefId) {
                throw new Error('Customer booksRefId is undefined');
            }
            if (!invoice.branch || !invoice.branch.booksRefId) {
                throw new Error('Branch booksRefId is undefined');
            }
            if (!invoice.serviceProvider || !invoice.serviceProvider.booksRefId) {
                throw new Error('ServiceProvider booksRefId is undefined');
            }
            const undefinedSaleItem = invoice.invoiceSaleItems.find(item => !item.booksRefId);
            if (undefinedSaleItem) {
                throw new Error(`Sale item booksRefId is undefined for item with id: ${undefinedSaleItem.itemId}`);
            }
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
            const response = await client.addRecord('invoices', this.getZohoInvoice(invoice));
            const createdInvoice = response.invoice;
 
            this.logger.info('Invoice created successfully', { createdInvoice });
            return this.mapFromZohoInvoice(createdInvoice);
        } catch (error) {
            this.logger.error('Error adding Invoice', { error });
            throw new Error('Error adding Invoice: ' + error);
        }
    }

    private async getZohoInvoiceFromId(id: string): Promise<any> {
        try {
            this.logger.info('Getting invoice by id %o', { id });
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
            const response = await client.getRecord('invoices', id);
            const invoice = this.mapFromZohoInvoice(response.invoice);
            this.logger.info('Invoice retrieved successfully %o', invoice);
            return invoice;
        } catch (error) {
            this.logger.error('Error getting invoice by id %o', { error });
            throw new Error('Error getting invoice by id: ' + error);
        }
    }

    private async getInvoicePayments(customerId:string, invoice_number: string): Promise<string[]> {
        if (!customerId) {
            throw new Error('Customer Id is undefined');
        }
        if (!invoice_number) {
            throw new Error('Invoice number is undefined');
        }
        try {
            this.logger.info('Getting invoice payments %o', { customerId, invoice_number });
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
            const response = await client.getRecords('customerpayments', { customer_id: customerId });
            this.logger.info('Customer payments retrieved successfully %o', response);
            const retValues: string[] =[];
            for (const payment of response.customerpayments) {
                if (payment.invoice_numbers == invoice_number) {
                    retValues.push(payment.payment_id);
                }
            }
            this.logger.info('Invoice payments retrieved successfully %o', retValues);
            return retValues;
        } catch (error) {
            this.logger.error('Error getting customer payments %o', { error });
            throw new Error('Error getting customer payments: ' + error);
        }
    }

    private async updateInvoice(invoice: BooksInvoice): Promise<BooksInvoice> {
        try {
            this.logger.info('Updating invoice %o', { invoice });
            if (!invoice.booksRefId) {
                throw new Error('Invoice booksRefId is undefined');
            }
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
            const zohoInvoice = this.getZohoInvoice(invoice);
            zohoInvoice.reason = 'Invoice updated by Cleopatra';
            const response = await client.updateRecord('invoices', invoice.booksRefId, zohoInvoice);
            const updatedInvoice = response.invoice;
            this.logger.info('Invoice updated successfully', { invoice });
            return this.mapFromZohoInvoice(updatedInvoice);
        } catch (error: any) {
            this.logger.error('Error updating invoice: %o', error);
            throw new Error('Error updating invoice: ' + JSON.stringify(error.response.data));
        }
    }

    private async processCustomerPayments(customer: Customer | undefined, branch: Branch | undefined, payments: BooksCustomerPayment[], zoho_invoice: BooksInvoice): Promise<void> {
        const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);

        if (!customer || !customer.booksRefId) {
            throw new Error('Customer booksRefId is undefined');
        }

        if (!branch || !branch.booksRefId) {
            throw new Error('Branch booksRefId is undefined');
        }
    

        if (!zoho_invoice.booksRefId || !zoho_invoice.customerInvoiceNumber) {
            throw new Error('Invoice booksRefId or invoice number is undefined');
        } 

        if (payments.length === 0) {
            this.logger.warn('No payments found for invoice. Skipping zoho payment creation');
            return;
        }

        await client.updateStatus('invoices', zoho_invoice.booksRefId ?? '', 'sent');
        for (const payment of payments) {
            const zohoPayment = await this.map2ZohoPayments(branch, payment, customer.booksRefId, zoho_invoice.booksRefId);
            const paymentResponse = await client.addRecord('customerpayments', zohoPayment);
            payment.booksRefId = paymentResponse.payment.payment_id;
            await DBCustomerPayment.update({ booksRefId: payment.booksRefId }, { where: { id: payment.id } });
        }

    }

    private async deleteInvoice(id: number): Promise<void> {
      //TODO: Implement this method if required
    }

    public async getInvoicePdf(id: string): Promise<any> {
        try {
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
            const response = await client.getInvoicePdf(id);
            return response;
        } catch (error) {
            this.logger.error(`Error fetching PDF for invoice with id ${id}:`, error);
            throw error;
        }
    }

    public async processQueueItem(item: Queue): Promise<Queue> {
        this.logger.info('Processing queue item', { item });
        if (item.action === 'createOrUpdate') {
            const params = item.params as BooksInvoice;
            const latestInvoice = await DBInvoice.getFullInvoiceById(item.entityId, true, this.orgId);
            if (!latestInvoice) {
                this.logger.error('Invoice not found', { params });
                item.metaData = { error: 'Invoice not found'} ;
                return item;
            }
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);

            let outputZohoInvoice : BooksInvoice;
            if (latestInvoice.booksRefId) {
                //Before updating we need to remove current payments. Otherwise Zoho will throw error that updating invoice is more than the payment
                let doesItHasNullBooksRefId = false;
                if (latestInvoice.payments) {
                    const currentPayments = latestInvoice.payments.map(payment => payment.booksRefId);
                    for (let i = 0; i < currentPayments.length; i++) {
                        if (currentPayments[i]) {
                            await client.deleteRecord('customerpayments', currentPayments[i] ?? '');
                        } else {
                            this.logger.warn('Skipping deletion of customer payment due to undefined booksRefId', { payment: currentPayments[i] });
                            doesItHasNullBooksRefId = true;
                        }
                    }
                }

                if (doesItHasNullBooksRefId) {
                    //This reduandant given that we have deleted payments already. This exists only because there are invoices without booksRefId
                    const oldInvoice = await this.getZohoInvoiceFromId(latestInvoice.booksRefId);
                    const currentPayments = await this.getInvoicePayments(latestInvoice?.customer?.booksRefId ?? '', oldInvoice.customerInvoiceNumber ?? '');
                    for (let i = 0; i < currentPayments.length; i++) {
                        if (currentPayments[i]) {
                            await client.deleteRecord('customerpayments', currentPayments[i] ?? '');
                        } else {
                            this.logger.warn('Skipping deletion of customer payment due to undefined booksRefId', { payment: currentPayments[i] });
                        }
                    }
                }
                outputZohoInvoice = await this.updateInvoice(latestInvoice);
            } else {
                outputZohoInvoice = await this.createInvoice(latestInvoice);
            }
            if (!outputZohoInvoice) {
                throw new Error('Output Zoho Invoice is undefined');
            }
            if (outputZohoInvoice.total != latestInvoice.total) {   
                this.logger.error('Total mismatch between zoho and our app: %o', { outputZohoInvoice, latestInvoice });
                throw new Error('Total mismatch between zoho and our app');
            } else {
                this.logger.info('Total matched between zoho and our app');
            }

            if (outputZohoInvoice && outputZohoInvoice.booksRefId) {
                await DBInvoice.update({ booksRefId: outputZohoInvoice.booksRefId,
                    metaData: outputZohoInvoice.metaData,
                    customerInvoiceNumber: outputZohoInvoice.customerInvoiceNumber
                }, { where: { id: item.entityId } });
                await this.processCustomerPayments(latestInvoice.customer, latestInvoice.branch, latestInvoice.payments ?? [],   outputZohoInvoice);
            }
            item.metaData = outputZohoInvoice;
            return item;
        }
        throw new Error(`Unknown action: ${item.action}`);
    }
}