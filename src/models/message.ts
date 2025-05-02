import { Model, DataTypes } from 'sequelize';
import sequelize from './database';
import { IMessage, MessageType, Status, MessageContent, MessageMetaData, Channel, IMessageInput } from '../types/commTypes';
import Endpoint from './endpoint';
import { User } from '../types/userTypes';

export interface DBMessage extends Omit<IMessage, 'from' | 'to' | 'sender'> {
    fromId: string;
    toId: string;
    senderId: string;
    createdBy: string;
    updatedBy: string;
    orgId: string;
    createdAt: Date;
    updatedAt: Date;
    fromEndpoint?: Endpoint;
    toEndpoint?: Endpoint;
    senderEndpoint?: Endpoint;
    from: Endpoint;
    to: Endpoint;
    sender: Endpoint;
}

type MessageCreationAttributes = Omit<DBMessage, 'from' | 'to' | 'sender' | 'id'>;

class Message extends Model<DBMessage, MessageCreationAttributes> implements DBMessage {
    public id!: string;
    public fromId!: string;
    public toId!: string;
    public senderId!: string;
    public type!: MessageType;
    public channel!: Channel;
    public content!: MessageContent;
    public status!: Status;
    public timestamp!: Date;
    public externalId?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public externalMetaData?: Record<string, any>;
    public metaData?: MessageMetaData;
    public createdBy!: string;
    public updatedBy!: string;
    public orgId!: string;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    public from!: Endpoint;
    public to!: Endpoint;
    public sender!: Endpoint;



    public static mapInterface2DBModel(message: IMessageInput, user: User): MessageCreationAttributes {
        return {
            fromId: message.fromId,
            toId: message.toId,
            senderId: message.senderId,
            type: message.type,
            channel: message.channel,
            content: message.content,
            status: message.status,
            timestamp: message.timestamp,
            externalId: message.externalId,
            externalMetaData: message.externalMetaData,
            metaData: message.metaData,
            createdBy: user.username,
            updatedBy: user.username,
            orgId: user.orgId,
            createdAt: new Date(),
            updatedAt: new Date()
        };
    }

    public static async mapDBModel2Interface(message: DBMessage): Promise<IMessage> {
        let [from, to, sender] : [Endpoint | null, Endpoint | null, Endpoint | null] = [message.from, message.to, message.sender];
        if (!from) {
            from = await Endpoint.findByPk(message.fromId);
        }
        if (!to) {
            to = await Endpoint.findByPk(message.toId);
        }
        if (!sender) {
            sender = await Endpoint.findByPk(message.senderId);
        }

        if (!from || !to || !sender) {
            throw new Error(`Endpoint not found for message ${message.id}`);
        }

        return {
            id: message.id,
            from: Endpoint.mapDBModel2Interface(from),
            to: Endpoint.mapDBModel2Interface(to),
            sender: Endpoint.mapDBModel2Interface(sender),
            type: message.type,
            channel: message.channel,
            content: message.content,
            status: message.status,
            externalId: message.externalId,
            externalMetaData: message.externalMetaData,
            metaData: message.metaData,
            timestamp: message.timestamp
        };
    }
}
Message.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        fromId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'Endpoints', // Ensure correct table name
                key: 'id'
            },
        },
        toId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'Endpoints', // Ensure correct table name
                key: 'id'
            },
        },
        senderId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'Endpoints', // Ensure correct table name
                key: 'id'
            },
        },
        type: {
            type: DataTypes.STRING,
            allowNull: false
        },
        channel: {
            type: DataTypes.STRING,
            allowNull: false
        },
        content: {
            type: DataTypes.JSON,
            allowNull: false
        },
        status: {
            type: DataTypes.STRING,
            allowNull: false
        },
        externalId: {
            type: DataTypes.STRING,
            allowNull: true
        },
        externalMetaData: {
            type: DataTypes.JSON,
            allowNull: true
        },
        metaData: {
            type: DataTypes.JSON,
            allowNull: true
        },
        createdBy: {
            type: DataTypes.STRING,
            allowNull: false
        },
        orgId: {
            type: DataTypes.UUID,
            allowNull: false
        },
        createdAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        updatedAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        timestamp: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW
        },
        updatedBy: {
            type: DataTypes.STRING,
            allowNull: false
        },
        // Association definitions
        from: {
            type: DataTypes.VIRTUAL,
            get() {
                return this.getDataValue('fromEndpoint');
            }
        },
        to: {
            type: DataTypes.VIRTUAL,
            get() {
                return this.getDataValue('toEndpoint');
            }
        },
        sender: {
            type: DataTypes.VIRTUAL,
            get() {
                return this.getDataValue('senderEndpoint');
            }
        }
    },
    {
        sequelize,
        tableName: 'Messages', // Updated table name to title case
        defaultScope: {
            include: [
                {
                    model: Endpoint,
                    as: 'fromEndpoint'
                },
                {
                    model: Endpoint,
                    as: 'toEndpoint'
                },
                {
                    model: Endpoint,
                    as: 'senderEndpoint'
                }
            ]
        }
    }
);

// Define associations with consistent aliases
Message.belongsTo(Endpoint, { as: 'fromEndpoint', foreignKey: 'fromId', constraints: false });
Message.belongsTo(Endpoint, { as: 'toEndpoint', foreignKey: 'toId', constraints: false });
Message.belongsTo(Endpoint, { as: 'senderEndpoint', foreignKey: 'senderId', constraints: false });

Endpoint.hasMany(Message, { as: 'FromMessages', foreignKey: 'fromId', constraints: false });
Endpoint.hasMany(Message, { as: 'ToMessages', foreignKey: 'toId', constraints: false });
Endpoint.hasMany(Message, { as: 'SenderMessages', foreignKey: 'senderId', constraints: false });

export default Message;