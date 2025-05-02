import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from './database';
import ServiceProvider from './serviceProvider'; // Import the ServiceProvider model
import Customer from './customer'; // Import the Customer model
import { Event as EventInterface, EventInput, EventType, EventDetails } from '../types/eventTypes'; // Import the types
import Branch from './branch'; // Import the Branch model
import { User } from '../types/userTypes';

interface EventAttributes {
    id: string;
    orgId: string; // Added orgId
    serviceProviderId?: string;
    customerId?: string;
    branchId?: string; // Added branchId
    eventDetails: EventDetails;
    startTime: Date;
    endTime?: Date;
    eventType: EventType;
    location: { latitude: number; longitude: number; description?: string }; 
    createdBy: string;
    updatedBy: string;
}

type EventCreationAttributes = Optional<EventAttributes, 'id'>;

class Event extends Model<EventAttributes, EventCreationAttributes> implements EventAttributes {
    public id!: string;
    public orgId!: string; // Added orgId
    public serviceProviderId?: string;
    public customerId?: string;
    public branchId?: string; // Added branchId
    public eventDetails!: EventDetails;
    public startTime!: Date;
    public endTime?: Date;
    public eventType!: EventType;
    public location!: { latitude: number; longitude: number; description?: string };
    public createdBy!: string;
    public updatedBy!: string;

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    public static mapDBModel2Interface(dbObject: Event): EventInterface {
        return {
            id: dbObject.id,
            serviceProviderId: dbObject.serviceProviderId,
            customerId: dbObject.customerId,
            branchId: dbObject.branchId, // Added branchId
            eventDetails: dbObject.eventDetails,
            startTime: dbObject.startTime,
            endTime: dbObject.endTime,
            eventType: dbObject.eventType,
            location: dbObject.location,

        };
    }

    public static mapInterface2DBModel(entry: EventInput, user: User): EventCreationAttributes {
        return {
            orgId: user.orgId, // Added orgId
            eventDetails: {
                details: entry.eventDetails?.details || '',
                reminderOffset: entry.eventDetails?.reminderOffset,
                reminderMessageId: entry.eventDetails?.reminderMessageId,
            },
            serviceProviderId: entry.serviceProviderId,
            customerId: entry.customerId,
            branchId: entry.branchId, // Added branchId
            startTime: entry.startTime,
            endTime: entry.endTime,
            eventType: entry.eventType,
            location: entry.location,
            createdBy: user.username,
            updatedBy: user.username,
        };
    }
}
Event.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        orgId: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        serviceProviderId: {
            type: DataTypes.UUID,
            allowNull: true,
            references: {
                model: ServiceProvider,
                key: 'id',
            },
        },
        customerId: {
            type: DataTypes.UUID,
            allowNull: true,
            references: {
                model: Customer,
                key: 'id',
            },
        },
        branchId: {
            type: DataTypes.UUID,
            allowNull: true,
            references: {
                model: Branch,
                key: 'id',
            },
        },
        
        startTime: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        endTime: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        eventDetails: {
            type: DataTypes.JSON,
            allowNull: false,
            defaultValue: {} // Add a default empty object
        },
        eventType: {
            type: DataTypes.ENUM,
            values: Object.values(EventType),
            allowNull: false,
        },
        location: {
            type: DataTypes.JSON,
            allowNull: false,
        },
        createdBy: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        updatedBy: {
            type: DataTypes.STRING,
            allowNull: false,
        },
    },
    {
        sequelize,
        tableName: 'Events',
    }
);

Event.belongsTo(ServiceProvider, { foreignKey: 'serviceProviderId', as: 'serviceProvider' });
Event.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });
Event.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });

export default Event;
