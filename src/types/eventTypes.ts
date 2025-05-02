export enum EventType {
    attendance = 'attendance',
    permission = 'permission',
    appointment = 'appointment',
}

export interface EventDetails {
    details?: string;
    reminderOffset?: number;
    reminderMessageId?: string;
}

export interface Event {
    id: string;
    serviceProviderId?: string;
    customerId?: string;
    branchId?: string; // Added branchId
    eventDetails: EventDetails; 
    startTime: Date;
    endTime?: Date;
    eventType: EventType;
    location: { latitude: number; longitude: number; description?: string }; 
}

export interface EventInput {
    serviceProviderId?: string;
    customerId?: string;
    branchId?: string; // Added branchId
    eventDetails: EventDetails; 
    startTime: Date;
    endTime?: Date;
    eventType: EventType;
    location: { latitude: number; longitude: number; description?: string }; 
}

