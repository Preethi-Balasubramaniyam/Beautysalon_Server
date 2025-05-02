import { Model, DataTypes, Optional } from 'sequelize';
import sequelize from './database';
import { Endpoint as IEndpoint, Channel } from '../types/commTypes';
import logger from '../common/logger';
import { PhoneNumberUtil, PhoneNumberFormat } from 'google-libphonenumber';
import OrgModel from './org';

interface DBEndpoint {
    id: string;
    channel: Channel;
    displayName: string;
    externalId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metaData?: Record<string, any>;
    userId?: string;
    orgId: string;
    createdAt: Date;
    updatedAt: Date;
}

type EndpointCreationAttributes = Optional<DBEndpoint, 'id'>;

class Endpoint extends Model<DBEndpoint, EndpointCreationAttributes> implements DBEndpoint {
    public id!: string;
    public channel!: Channel;
    public displayName!: string;
    public externalId!: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public metaData?: Record<string, any>;
    public userId?: string;
    public orgId!: string;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    public static mapInterface2DBModel(endpoint: IEndpoint, orgId: string): DBEndpoint {
        return {
            id: endpoint.id,
            channel: endpoint.channel,
            displayName: endpoint.displayName,
            externalId: endpoint.externalId,
            metaData: endpoint.metaData,
            userId: endpoint.userId,
            orgId,
            createdAt: new Date(),
            updatedAt: new Date()
        };
    }

    public static mapDBModel2Interface(endpoint: DBEndpoint): IEndpoint {
        return {
            id: endpoint.id,
            channel: endpoint.channel,
            displayName: endpoint.displayName,
            externalId: endpoint.externalId,
            metaData: endpoint.metaData,
            userId: endpoint.userId
        };
    }

    // Helper function to normalize phone number
    private static async normalizePhoneNumber(externalId: string, orgId: string): Promise<{ normalizedExternalId: string; error?: string }> {
        try {
            const orgConfig = await OrgModel.getConfiguration(orgId);
            const countryCode = orgConfig?.countryCode || 'IN';
            
            const phUtil = PhoneNumberUtil.getInstance();
            const parsedNumber = phUtil.parse(externalId, countryCode);
            return { normalizedExternalId: phUtil.format(parsedNumber, PhoneNumberFormat.E164) };
        } catch (error) {
            logger.warn('Invalid phone number format %o', { externalId, error });
            return { normalizedExternalId: externalId, error: 'Invalid phone number format' };
        }
    }

    public static async findOrCreateByExternalId(
        orgId: string,
        externalId: string,
        channel: Channel,
        displayName: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metaData?: Record<string, any>,
        userId?: string
    ): Promise<IEndpoint> {
        try {
            let normalizedExternalId = externalId;

            // Normalize phone number if channel is WhatsApp, Call, or SMS
            if ([Channel.whatsapp, Channel.call, Channel.sms].includes(channel)) {
                const result = await this.normalizePhoneNumber(externalId, orgId);
                if (result.error) {
                    throw new Error(result.error);
                }
                normalizedExternalId = result.normalizedExternalId;
            }

            const [endpoint, created] = await Endpoint.findOrCreate({
                where: {
                    orgId,
                    externalId: normalizedExternalId,
                    channel
                },
                defaults: {
                    orgId,
                    externalId: normalizedExternalId,
                    channel,
                    displayName,
                    metaData,
                    userId,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
            });

            if (created) {
                logger.info('Created new endpoint', { endpoint: endpoint.id, externalId: normalizedExternalId, channel });
            } else {
                logger.info('Found existing endpoint', { endpoint: endpoint.id, externalId: normalizedExternalId, channel });
            }

            return Endpoint.mapDBModel2Interface(endpoint);
        } catch (error) {
            logger.error('Error in findOrCreateByExternalId endpoint:', error);
            throw error;
        }
    }
}

Endpoint.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        channel: {
            type: DataTypes.STRING,
            allowNull: false
        },
        displayName: {
            type: DataTypes.STRING,
            allowNull: false
        },
        externalId: {
            type: DataTypes.STRING,
            allowNull: false
        },
        metaData: {
            type: DataTypes.JSON,
            allowNull: true
        },
        userId: {
            type: DataTypes.UUID,
            allowNull: true
        },
        orgId: {
            type: DataTypes.UUID,
            allowNull: false
        },
        createdAt: {
            type: DataTypes.DATE,
            allowNull: false
        },
        updatedAt: {
            type: DataTypes.DATE,
            allowNull: false
        }
    },
    {
        sequelize,
        tableName: 'Endpoints',
        indexes: [
            {
                unique: true,
                fields: ['orgId', 'channel', 'externalId']
            }
        ]
    }
);

export default Endpoint; 