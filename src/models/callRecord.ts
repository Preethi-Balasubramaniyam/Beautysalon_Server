import { Model, DataTypes } from 'sequelize';
import sequelize from './database';
import Endpoint from './endpoint';
import { CallType, ICallRecordInput, ICallRecord, CallRecordDetails } from '../types/commTypes';
import { User } from '../types/userTypes';

export interface DBCallRecord extends ICallRecord {
    fromId: string;
    toId: string;
    initiatorId: string;
    createdBy: string;
    updatedBy: string;
    orgId: string;
    createdAt: Date;
    updatedAt: Date;
}

type CallRecordCreationAttributes = Omit<DBCallRecord, 'from' | 'to' | 'initiator' | 'id'>;

class CallRecord extends Model<DBCallRecord, CallRecordCreationAttributes> implements DBCallRecord {
    public id!: string;
    public fromId!: string;
    public toId!: string;
    public initiatorId!: string;
    public type!: CallType;
    public timestamp!: Date;
    public callStartTime!: Date;
    public externalId?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public externalMetaData?: Record<string, any>;
    public details?: CallRecordDetails;
    public createdBy!: string;
    public updatedBy!: string;
    public orgId!: string;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    public from!: Endpoint;
    public to!: Endpoint;
    public readonly initiator!: Endpoint;

    public static mapInterface2DBModel(callRecord: ICallRecordInput, user: User): CallRecordCreationAttributes {
        return {
            fromId: callRecord.fromId,
            toId: callRecord.toId,
            initiatorId: callRecord.initiatorId,
            type: callRecord.type,
            callStartTime: callRecord.callStartTime,
            details: callRecord.details,
            createdBy: user.username,
            updatedBy: user.username,
            orgId: user.orgId,
            createdAt: new Date(),
            updatedAt: new Date()
        };
    }

    public static async mapDBModel2Interface(callRecord: DBCallRecord): Promise<ICallRecord> {
        const [from, to, initiator] = await Promise.all([
            Endpoint.findByPk(callRecord.fromId),
            Endpoint.findByPk(callRecord.toId),
            Endpoint.findByPk(callRecord.initiatorId)
        ]);

        if (!from || !to || !initiator) {
            throw new Error(`Endpoint not found for call record ${callRecord.id}`);
        }

        return {
            id: callRecord.id,
            from: Endpoint.mapDBModel2Interface(from),
            to: Endpoint.mapDBModel2Interface(to),
            initiator: Endpoint.mapDBModel2Interface(initiator),
            type: callRecord.type,
            details: callRecord.details,
            callStartTime: callRecord.callStartTime
        };
    }
}

CallRecord.init(
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
                model: 'Endpoints',
                key: 'id'
            }
        },
        toId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'Endpoints',
                key: 'id'
            }
        },
        initiatorId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'Endpoints',
                key: 'id'
            }
        },
        type: {
            type: DataTypes.STRING,
            allowNull: false
        },
        details: {
            type: DataTypes.JSON,
            allowNull: true
        },
        createdBy: {
            type: DataTypes.STRING,
            allowNull: false
        },
        orgId: {
            type: DataTypes.STRING,
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
        callStartTime: {
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
                return this.getDataValue('fromId');
            }
        },
        to: {
            type: DataTypes.VIRTUAL,
            get() {
                return this.getDataValue('toId');
            }
        },
        initiator: {
            type: DataTypes.VIRTUAL,
            get() {
                return this.getDataValue('initiatorId');
            }
        }
    },
    {
        sequelize,
        tableName: 'CallRecords', // Updated table name to title case
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
                    as: 'initiatorEndpoint'
                }
            ]
        }
    }
);

// Define associations
CallRecord.belongsTo(Endpoint, { as: 'fromEndpoint', foreignKey: 'fromId', constraints: false });
CallRecord.belongsTo(Endpoint, { as: 'toEndpoint', foreignKey: 'toId', constraints: false });
CallRecord.belongsTo(Endpoint, { as: 'initiatorEndpoint', foreignKey: 'initiatorId', constraints: false });

export default CallRecord;

