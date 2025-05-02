import { Logger } from 'winston';
import { ZohoBooksClient } from './zohoBooksClient';
import DBBranch from '../models/branch';
import { Branch } from '../types/branchTypes';
import { Queue } from '../types/queueTypes';

type BooksBranch = Pick<Branch, 'name' | 'postalCode' | 'city' | 'state' | 'address' | 'booksRefId' >;

export interface BooksAccountDetails {
    id: string;
    name: string;
    type: 'cash' | 'bank';
}

export class ZohoBranchService {
    private logger: Logger;
    private orgId: string;

    constructor(logger: Logger, orgId: string) {
        this.orgId = orgId;
        this.logger = logger;
    }

    private mapZohoBranchToBooksBranch(zohoBranch: any): BooksBranch {
        return {
            name: zohoBranch.branch_name,
            postalCode: zohoBranch.address.postal_code,
            city: zohoBranch.address.city,
            state: zohoBranch.address.state,
            address: zohoBranch.address.street_address1 + ',' + zohoBranch.address.street_address2,
            booksRefId: zohoBranch.branch_id,
        };
    }

    private mapBooksBranchToZohoBranch(branch: BooksBranch): any {
        return {
            branch_name: branch.name,
            address: {
                street_address1: branch.address.split(',')[0],
                street_address2: branch.address.split(',')[1],
                city: branch.city,
                state: branch.state,
                postal_code: branch.postalCode
            }
        };
    }

    private populateZohoBranchOnExistingData(existingBranch: any, branch: BooksBranch): any {
        existingBranch.branch_name = branch.name;
        existingBranch.address.street_address1 = branch.address.split(',')[0];
        existingBranch.address.street_address2 = branch.address.split(',')[1];
        existingBranch.address.city = branch.city;
        existingBranch.address.state = branch.state;
        existingBranch.address.postal_code = branch.postalCode;
        delete existingBranch.branch_id;
        return existingBranch;
    }

    public async getAccountDetails(): Promise<BooksAccountDetails[]> {
        this.logger.info('Getting account IDs');
        let accounts: BooksAccountDetails[] = [];
        try {
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
            const response = await client.getRecords('chartofaccounts', { filter_by : 'AccountType.Active' });
            for (const account of response.chartofaccounts) {
                if (account.account_type === 'bank' || account.account_type === 'cash') {
                    accounts.push({ 
                        id: account.account_id, 
                        name: account.account_name, 
                        type: account.account_type 
                    });
                }
            }
            this.logger.info(`Returning Accounts: ${JSON.stringify(accounts)}`);
            return accounts;
        } 
        catch (error: any) {
                this.logger.error(`Error getting account IDs: ${error}`);
                throw new Error('Error getting account IDs: ' + error);
        }
    }

    public async addOrUpdateBranch(inputBranch: BooksBranch): Promise<BooksBranch | undefined> {
        //TODO: Update the logic to actually update the existing branch details 
        this.logger.info(`Adding or updating branch with name: ${inputBranch.name}`);
        try {
            const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
            const response = await client.getRecords('branches');
            if (!response.branches || response.branches.length === 0) {
                this.logger.error('No branches found in Zoho Books');
                throw new Error('No branches found in Zoho Books');
            }
            const existingBranch = response.branches.find((branch: any) => branch.branch_name === inputBranch.name);
            const anyRadomBranch = response.branches[0];
            if (existingBranch) {
                const newBranch = this.mapZohoBranchToBooksBranch(existingBranch);
                this.logger.info(`Found branch in Zoho Books: ${JSON.stringify(newBranch)}`);
                return newBranch;
            } else {
                const zohoBranch = this.populateZohoBranchOnExistingData(anyRadomBranch, inputBranch);
                const client = await ZohoBooksClient.getInstance(this.logger, this.orgId);
                const response = await client.addRecord('branches', zohoBranch);
                const newBranch = this.mapZohoBranchToBooksBranch(response);
                this.logger.info(`Added branch in Zoho Books: ${JSON.stringify(newBranch)}`);
                return newBranch;
            }
        } catch (error) {
            this.logger.error(`Error adding/updating branch: ${error}`);
            throw new Error('Error adding/updating branch: ' + error);
        }
    }

    public async processQueueItem(item: Queue): Promise<Queue> {
        this.logger.info(`Processing queue item: ${JSON.stringify(item)}`);
        if (item.action === 'createOrUpdate') {
            const params = await DBBranch.findByPk(item.entityId);
            if (!params) {
                this.logger.error(`Branch entity #${item.entityId} not found`);
                throw new Error(`Branch entity #${item.entityId} not found`);
            }   
            const newZohoBranch = await this.addOrUpdateBranch(params);
            if (newZohoBranch) {
                await DBBranch.update({
                    booksRefId: newZohoBranch.booksRefId,
                }, { where: { id: item.entityId } });
                this.logger.info(`Branch updated successfully for id: ${item.entityId}`);
            } else {
                this.logger.error('newZohoBranch is undefined');
                throw new Error('newZohoBranch is undefined');
            }
            this.logger.info(`Branch updated successfully for id: ${item.entityId}`);
            item.metaData = newZohoBranch;
            return item;
        }
        throw new Error(`Unknown action: ${item.action}`);
        
    }
    
}
