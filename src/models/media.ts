import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from './database';
import Org from './org';
import Branch from './branch';
import { MediaCreateRequest, Media as MediaInterface, Tag } from '../types/mediaTypes'; // Import Tag
import { User } from '../types/userTypes';

// Remove TagAttributes interface

interface MediaAttributes {
    id: string;
    url: string;
    contentType: string;
    orgId: string;
    branchId?: string;
    customerId?: string;
    tags?: Tag[]; // Use Tag from mediaTypes
    createdBy: string;
    updatedBy: string;
}

interface MediaCreationAttributes extends Optional<MediaAttributes, 'id'> {}

class Media extends Model<MediaAttributes, MediaCreationAttributes> implements MediaAttributes {
    public id!: string;
    public url!: string;
    public contentType!: string;
    public orgId!: string;
    public branchId?: string;
    public customerId?: string;
    public tags?: Tag[]; // Use Tag from mediaTypes
    public createdBy!: string;
    public updatedBy!: string;

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
    
    public static toDBCreateModel(input: MediaCreateRequest, user: User): MediaCreationAttributes {
        return {
            url: input.url,
            contentType: input.contentType,
            orgId: user.orgId,
            branchId: input.branchId,
            customerId: input.customerId, // Include customerId
            tags: input.tags?.map((item) => ({ type: item.type, value: item.value })), // This is to prevent random fields from being added
            createdBy: user.username,
            updatedBy: user.username
        };
    }

    public static fromDBModel(media: Media): MediaInterface {
        return {
            id: media.id,
            url: media.url,
            contentType: media.contentType,
            branchId: media.branchId,
            customerId: media.customerId, // Include customerId
            tags: media.tags, // Include tags
            updatedAt: media.updatedAt,
            updatedBy: media.updatedBy,
            createdAt: media.createdAt,
            createdBy: media.createdBy,
        };
    }

    public static async getAllMediaByBranchId(branchId: string): Promise<Media[]> {
        return await Media.findAll({ where: { branchId } });
    }

    public static async getAllMedia(orgId: string): Promise<Media[]> {
        return await Media.findAll({ where: { orgId } });
    }
}

Media.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        url: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        contentType: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        orgId: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        branchId: {
            type: DataTypes.UUID,
            allowNull: true, // Ensure null is allowed
            references: {
                model: Branch,
                key: 'id',
            },
        },
        customerId: {
            type: DataTypes.UUID,
            allowNull: true, // Ensure null is allowed
            references: {
                model: 'Customers', // Assuming there is a Customers model
                key: 'id',
            },
        },
        tags: {
            type: DataTypes.JSON, // Store tags as JSONB
            allowNull: true,
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
        tableName: 'Media',
    }
);

Media.belongsTo(Branch, {
    foreignKey: 'branchId',
    as: 'branch'
});

export default Media;
