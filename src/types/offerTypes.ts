import { SaleItem } from './saleItemTypes';

export interface Offer {
    id: string;
    name: string;
    rate: number;
    saleItems: SaleItem[];
}

export interface OfferInput {
    name: string;
    rate: number;
    saleItemIds: string[];
}
