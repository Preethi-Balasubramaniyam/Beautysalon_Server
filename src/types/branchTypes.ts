import { Endpoint } from './commTypes'; // Import Endpoint

export interface BranchRequest {
    name?: string;
    skill?: string;
}

export interface BranchCreateRequest {
    name: string;
    postalCode: string;
    city: string;
    state: string;
    address: string;
    cashLedgerId: string; // Added booksCashAccountId
    bankLedgerId: string; // Added booksBankAccountId
    commEndpoints: Endpoint[]; // Add endpoints field
}

export interface BranchUpdateRequest {
    name?: string;
    postalCode?: string;
    city?: string;
    state?: string;
    address?: string;
    cashLedgerId?: string; // Added booksCashAccountId
    bankLedgerId?: string; // Added booksBankAccountId
    commEndpoints?: Endpoint[]; // Add endpoints field
}

export interface Branch {
    id: string;
    name: string;
    postalCode: string;
    city: string;
    state: string;
    address: string;
    booksRefId?: string | undefined;
    cashLedgerId?: string | undefined; // Added booksCashAccountId
    bankLedgerId?: string | undefined; // Added booksBankAccountId
    commEndpoints?: Endpoint[]; // Add endpoints field
}

export interface BranchDetailsResponse {
    branch: Branch;
    thisMonthRevenue: number;
    last7daysRevenue: number[]; // Changed from totalRevenueForToday to last7daysRevenue
    next7daysAppointmentsCount: number[]; // Changed to array
    noOfActiveLeads: number; // Added noOfActiveLeads
}

