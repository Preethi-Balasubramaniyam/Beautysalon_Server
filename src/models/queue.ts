import { Model, DataTypes } from 'sequelize';
import sequelize from './database';
import { Queue as QueueInterface, Module } from '../types/queueTypes'; // Import Queue type and Module enum

class Queue extends Model {
    public id!: string;
    public params!: object;
    public action!: string;
    public processCount!: number;
    public status!: string;
    public module!: Module; 
    public orgId!: string; // Add orgId property
    public entityId!: string; // Add entityId property
    public metaData?: object; // Add metaData property
    
    public createdAt!: Date;
    public updatedAt!: Date;

    public static mapDBModel2Interface(queue: Queue): QueueInterface {
        return {
            id: queue.id,
            params: queue.params,
            action: queue.action,
            processCount: queue.processCount,
            status: queue.status,
            module: queue.module,
            orgId: queue.orgId,
            entityId: queue.entityId, // Map entityId
            metaData: queue.metaData, // Map metaData
        };
    }
}

Queue.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        params: {
            type: DataTypes.JSON,
            allowNull: false,
        },
        action: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        processCount: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        status: {
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'pending', // Add default status
        },
        module: {
            type: DataTypes.ENUM(...Object.values(Module)), // Use Module enum
            allowNull: false,
        },
        orgId: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        entityId: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        metaData: {
            type: DataTypes.JSON,
            allowNull: true, // Allow null for metaData
        },
    },
    {
        sequelize,
        tableName: 'Queues',
    }
);

export default Queue;