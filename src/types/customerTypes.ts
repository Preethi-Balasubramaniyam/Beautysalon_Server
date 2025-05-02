import { Invoice } from './invoiceTypes'; // Import Invoice type
import { Event } from './eventTypes'; // Import Event type

export interface CustomerInput {
    name: string;
    email?: string; // Optional
    mobile: string;
    city?: string; // Optional
    booksRefId?: string; // Optional
    postalCode: string;
    address?: string; // Optional
    defaultBranchId?: string; // Optional
    dateOfBirth?: string; // Optional
    gender: 'm' | 'f' | 'u'; 
}

export interface Customer {
    id: string;
    name: string;
    email?: string | undefined; // Optional
    mobile: string;
    city?: string | undefined; // Optional
    booksRefId?: string | undefined; // Optional
    postalCode: string;
    address?: string | undefined; // Optional
    defaultBranchId?: string | undefined; // Optional
    dateOfBirth?: string | undefined; // Optional
    gender: 'm' | 'f' | 'u'; 
}

export interface GetCustomerOutput {
    customer: Customer;
    invoices: {id: string, date: Date, total:number}[];
    events: Event[];
    revenueForLastYear: number;
    revenueForLastMonth: number;
}