export enum Module {
    Customer = 'Customer',
    Item = 'Item',
    Invoice = 'Invoice',
    Branch = 'Branch',
    ServiceProvider = 'ServiceProvider',
    Account = 'Account'
}

export interface Queue {
    id: string;
    params: object;
    action: string;
    processCount: number;
    status: string;
    module: Module;
    orgId: string;
    entityId: string; 
    metaData?: object; // Add metaData field
}
