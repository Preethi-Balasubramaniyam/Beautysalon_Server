import { Logger } from 'winston';
import { ZohoBooksClient } from './zohoBooksClient';
import Ledger from '../models/ledger';
import { Queue } from '../types/queueTypes';
import { Ledger as LedgerType } from '../types/ledgerTypes';

type BooksLedger = Pick<LedgerType, 'name' | 'type' | 'booksRefId'>;

export class ZohoLedgerService {
    private logger: Logger;
    private orgId: string;

    constructor(logger: Logger, orgId: string) {
        this.logger = logger;
        this.orgId = orgId;
        this.logger.info('BooksAccountData service initialized');
    }

    private mapZohoAccountToBooksAccount(zohoLedger: any): BooksLedger {
        return {
            name: zohoLedger.account_name,
            type: zohoLedger.account_type,
            booksRefId: zohoLedger.account_id,
        };
    }

    private mapBooksAccountToZohoAccount(ledger: BooksLedger): any {
        return {
            account_name: ledger.name,
            account_type: ledger.type,
            account_id: ledger.booksRefId,
        };
    }

    public async processQueueItem(item: Queue): Promise<Queue> {
        this.logger.info('Processing queue item: %o', item);
        if (item.action === 'createOrUpdate') {
            const params = await Ledger.findByPk(item.entityId);
            if (!params) {
                this.logger.error('Ledger with ID %s not found', item.entityId);
                throw new Error(`Ledger with ID ${item.entityId} not found`);
            }
            const newZohoAccount = await this.addOrUpdateAccount(Ledger.mapDBModel2Interface(params));
            if (newZohoAccount && newZohoAccount.booksRefId) {
                await Ledger.update({ booksRefId: newZohoAccount.booksRefId }, { where: { id: item.entityId } });
            }
            item.metaData = newZohoAccount;
            return item;
        }
        throw new Error(`Unknown action: ${item.action}`);
    }

    private async addOrUpdateAccount(ledger: BooksLedger): Promise<BooksLedger> {
        this.logger.info('Adding or updating account: %o', ledger);
        try {
            if (ledger.booksRefId) {
                return this.updateBooksAccount(ledger.booksRefId, ledger);
            } else {
                return this.addBooksAccount(ledger);
            }
        } catch (error) {
            this.logger.error('Error adding or updating account in Zoho Books:', error);
            throw error;
        }
    }

    private async addBooksAccount(ledger: BooksLedger): Promise<BooksLedger> {
        this.logger.info('Adding new Books account: %o', ledger);
        try {
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
            // Get all accounts from Zoho
            const existingAccounts = await client.getRecords('chartofaccounts');
            
            // Check if an account with the same name exists
            const existingAccount = existingAccounts['chartofaccounts'].find((acc: any) => acc.account_name === ledger.name);
            
            if (existingAccount) {
                if (existingAccount.account_type !== ledger.type) {    
                    throw new Error(`Account with name ${ledger.name} already exists with a different type`);
                }
                // If account with the same name exists, map and return it
                return this.mapZohoAccountToBooksAccount(existingAccount);
            } else {
                // If no account with the same name exists, add a new account
                const zohoAccount = this.mapBooksAccountToZohoAccount(ledger);
                const response = await client.addRecord('chartofaccounts', zohoAccount);
                return this.mapZohoAccountToBooksAccount(response.chart_of_account);
            }
        } catch (error) {
            this.logger.error('Error adding account in Zoho Books:', error);
            throw error;
        }
    }

    private async updateBooksAccount(booksRefId: string, account: BooksLedger): Promise<BooksLedger> {
        this.logger.info('Updating Books account with ID %s: %o', booksRefId, account);
        try {
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
            const zohoAccount = this.mapBooksAccountToZohoAccount(account);
            const response = await client.updateRecord('chartofaccounts', booksRefId, zohoAccount);
            return this.mapZohoAccountToBooksAccount(response);
        } catch (error) {
            this.logger.error('Error updating account in Zoho Books:', error);
            throw error;
        }
    }
}
