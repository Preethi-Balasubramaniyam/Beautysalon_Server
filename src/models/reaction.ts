import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from './database';
import { Reaction as IReaction, Channel, ReactionType } from '../types/commTypes';
import Endpoint from './endpoint';
import { User } from '../types/userTypes';

interface DBReaction {
    id: string;
    Channel: Channel;
    reactionType: ReactionType;
    orgId: string;
    comment?: string;
    endpointId: string; // Reference to the endpoint
    createdAt: Date;
    updatedAt: Date;
    createdBy: string;
    updatedBy: string;
}

type ReactionCreationAttributes = Optional<DBReaction, 'id' | 'comment'>;

class Reaction extends Model<DBReaction, ReactionCreationAttributes> implements DBReaction {
    public id!: string;
    public orgId!: string;
    public Channel!: Channel;
    public reactionType!: ReactionType;
    public comment?: string;
    public endpointId!: string;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
    public createdBy!: string;
    public updatedBy!: string;

    public static mapInterface2DBModel(input: IReaction, user: User): DBReaction {
        return {
            id: input.id,
            Channel: input.Channel,
            orgId: user.orgId,
            reactionType: input.reactionType,
            comment: input.comment,
            endpointId: input.endpointId.id,
            createdBy: user.username,
            updatedBy: user.username,
            createdAt: new Date(), // Add createdAt field
            updatedAt: new Date(), // Add updatedAt field
        };
    }

    public static async mapDBModel2Interface(reaction: DBReaction): Promise<IReaction> {
        const endpoint = await Endpoint.findByPk(reaction.endpointId);
        if (!endpoint) {
            throw new Error(`Endpoint not found for reaction ${reaction.id}`);
        }

        return {
            id: reaction.id,
            Channel: reaction.Channel,
            reactionType: reaction.reactionType,
            comment: reaction.comment,
            endpointId: Endpoint.mapDBModel2Interface(endpoint),
        };
    }
}

Reaction.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        Channel: {
            type: DataTypes.ENUM(...Object.values(Channel)),
            allowNull: false,
        },
        reactionType: {
            type: DataTypes.ENUM(...Object.values(ReactionType)),
            allowNull: false,
        },
        orgId: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        comment: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        endpointId: {
            type: DataTypes.UUID, // Changed from STRING to UUID to match Endpoints.id
            allowNull: false,
            references: {
                model: 'Endpoints', // Assuming you have an Endpoints model
                key: 'id',
            },
        },
        createdAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
        updatedAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
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
        tableName: 'Reactions',
        defaultScope: {
            include: [
                {
                    model: Endpoint,
                    as: 'endpoint',
                },
            ],
        },
    }
);

// Define associations with consistent aliases
Reaction.belongsTo(Endpoint, {
    foreignKey: 'endpointId',
    as: 'endpoint',
});

Endpoint.hasMany(Reaction, {
    foreignKey: 'endpointId',
    as: 'reactions',
});

export default Reaction;
