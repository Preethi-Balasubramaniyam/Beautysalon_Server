// Import Branch type
import { Branch } from './branchTypes';
import { Event } from './eventTypes';

export interface ServiceProvider {
    id: string;
    name: string;
    email?: string;
    mobile: string;
    branchId: string;
    branch?: Branch;
    booksRefId?: string;
    status: 'Active' | 'InActive';
    experience?: number;
}

export interface GetServiceProvidersRequest {
    name?: string;
    branchId?: string;
    mobile?: string;
    status?: 'Active' | 'InActive';
    page?: number;
    pageSize?: number;
}

export interface CreateServiceProviderRequest {
    name: string;
    email?: string;
    mobile: string;
    branchId: string;
    booksRefId?: string;
    status: 'Active' | 'InActive';
    experience?: number;
}

export interface UpdateServiceProviderRequest {
    name?: string;
    email?: string;
    mobile?: string;
    branchId?: string;
    booksRefId?: string;
    status?: 'Active' | 'InActive';
    experience?: number;
}

export interface GetSalesProviderOutput {
    serviceProvider: ServiceProvider;
    totalRevenueThisMonth: number;
    last5AttendanceRecords: Event[];
    upcoming5Appointments: Event[];
}


