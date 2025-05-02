import { User } from "./userTypes";

export enum LedgerType {
    Cash = 'cash',
    Bank = 'bank'
}

export interface Ledger {
    id: string;
    name: string;
    type: LedgerType;
    booksRefId: string | undefined;
}

export interface LedgerCreateRequest {
    name: string;
    type: LedgerType;
    booksRefId: string | undefined;
}


