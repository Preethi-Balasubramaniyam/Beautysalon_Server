import { Customer } from "../types/customerTypes";
import { ServiceProvider } from "../types/serviceProviderTypes";
import { Branch } from "./branchTypes";
import { SaleItem } from "./saleItemTypes"; // Adjust the import path as necessary

export enum PaymentMode {
    cash = 'cash',
    upi = 'upi',
    card = 'card'
}

export interface InvoiceInput {
    date: string;
    serviceProviderId: string;
    customerId: string;
    branchId: string;
    booksRefId?: string;
    customerInvoiceNumber?: string; // Add this field
    invoiceSaleItems: InvoiceSaleItemInput[];
    payments?: CustomerPaymentInput[];
    discounts?: Discount[];
    roundOff?: number; // Add this field
    metaData?: {
        booksInvoiceJson?: string;
        invoice_number?: string;
    }; // Add this field
}

export interface Discount {
    type: 'percentage' | 'amount';
    value: number;
    couponCode?: string;
    reason?: string;
}

export interface InvoiceSaleItem {
    itemId: string;
    quantity: number;
    rate: number;
    booksRefId?: string;
}

export interface InvoiceSaleItemInput {
    itemId: string;
    quantity: number;
    rate: number;
}

export interface Invoice {
    id: string;
    date: string;
    serviceProviderId: string;
    customerId: string;
    branchId: string;
    total: number;
    payments?: CustomerPayment[];
    discounts?: Discount[];
    booksRefId?: string;
    customerInvoiceNumber?: string; // Add this field
    invoiceSaleItems: InvoiceSaleItem[];
    customer?: Customer;
    serviceProvider?: ServiceProvider;
    branch?: Branch;
    roundOff?: number; // Add this field
    metaData?: object; // Add this field
}

export interface CustomerPayment {
    id: string;
    customerId: string;
    paymentMode: PaymentMode;
    amount: number;
    date: string;
    invoiceId: string;
    booksRefId?: string;
}

export interface CustomerPaymentInput {
    paymentMode: PaymentMode;
    amount: number;
    date: string;
}