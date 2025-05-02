import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from './database';
import { SaleItemCategory as SaleItemCategoryInterface, SaleItemCategoryInput } from '../types/saleItemTypes';
import { User } from '../types/userTypes';

interface SaleItemCategoryCreationAttributes extends Optional<SaleItemCategoryAttributes, 'id'> {}

interface SaleItemCategoryAttributes {
    id: string;
    hsnSacCode: string;
    name: string;
    type: 'service' | 'product';
    taxPercent: number;
    description?: string; // updated to be nullable
    createdBy: string;
    updatedBy: string;
    orgId: string; // added orgId
}

class SaleItemCategory extends Model<SaleItemCategoryAttributes, SaleItemCategoryCreationAttributes> implements SaleItemCategoryAttributes {
    public id!: string;
    public hsnSacCode!: string;
    public name!: string;
    public description!: string; // updated to be nullable
    public type!: 'service' | 'product';
    public taxPercent!: number;
    public createdBy!: string;
    public updatedBy!: string;
    public orgId!: string; // added orgId

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    public static fromInput(input: SaleItemCategoryInput, user: User): SaleItemCategoryCreationAttributes {
        return {
            hsnSacCode: input.hsnSacCode,
            name: input.name,
            description: input.description,
            type: input.type,
            taxPercent: input.taxPercent,
            createdBy: user.username,
            updatedBy: user.username    ,
            orgId: user.orgId, // added orgId
        };
    }

    public static fromDBModel(instance: SaleItemCategory): SaleItemCategoryInterface {
        return {
            id: instance.id,
            hsnSacCode: instance.hsnSacCode,
            name: instance.name,
            description: instance.description,
            type: instance.type,
            taxPercent: instance.taxPercent,
        };
    }
}

SaleItemCategory.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        hsnSacCode: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        description: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        type: {
            type: DataTypes.ENUM('service', 'product'),
            allowNull: false,
        },
        taxPercent: {
            type: DataTypes.DECIMAL(5, 2),
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
        orgId: {
            type: DataTypes.STRING,
            allowNull: false,
        },
    },
    {
        sequelize,
        tableName: 'SaleItemCategories',
        indexes: [
            {
                unique: true,
                fields: ['name', 'orgId'], // Add unique constraint on name and orgId
            },
        ],
    }
);

export default SaleItemCategory ;