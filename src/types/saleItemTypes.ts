export interface SaleItemInput {
    name: string;
    rate: number;
    categoryId: string;
    booksRefId?: string;
}

export interface SaleItem {
    id: string;
    name: string;
    rate: number;
    categoryId: string;
    booksRefId?: string;
    category?: SaleItemCategory;
}

export interface SaleItemCategoryInput {
    hsnSacCode: string;
    name: string;
    description?: string ; // updated to be nullable
    type: 'product' | 'service';
    taxPercent: number;
}

export interface SaleItemCategory {
    id: string;
    hsnSacCode: string;
    name: string;
    description?: string; // updated to be nullable
    type: 'product' | 'service';
    taxPercent: number;
}