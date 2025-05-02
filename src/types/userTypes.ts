export enum UserRole {
    Admin = 'Admin',
    Manager = 'Manager',
    ServiceProvider = 'ServiceProvider',
    ReadOnlyUser = 'ReadOnlyUser'
}

export enum UserScope { //TODO: For now using Role as scope, but can be extended to include more scopes
    Admin = 'admin',
    Manager = 'manager',
    ReadOnlyUser = 'readOnlyUser',
    ServiceProvider = 'serviceProvider'
}

export interface RegisterInput {
    username: string;
    password: string;
    role: UserRole;
    email: string;
    mobile: string;
    name: string;
    serviceProviderId?: string;
}

export interface RegisterOutput {
    message: string;
}

export interface UpdateUserInput {
    username?: string;
    role?: UserRole;
    email?: string;
    mobile?: string;
    name?: string;
    password?: string;
    serviceProviderId?: string;
}

export interface UpdateUserOutput {
    message: string;
}

export interface User {
    id: string;
    username: string;
    scope: UserScope[];
    role: UserRole;
    email: string;
    mobile: string;
    name: string;
    serviceProviderId?: string;
    orgId: string;
}

export interface GetUsersInput {
    username?: string;
    mobile?: string;
    email?: string;
    role?: UserRole;
    serviceProviderId?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortOrder?: string;
    filter?: string;
}