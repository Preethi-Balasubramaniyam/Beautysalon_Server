import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from './database';
import SaleItemCategory from './saleItemCategory'; // Import SaleItemCategory
import { SaleItemInput, SaleItem as SaleItemInterface } from '../types/saleItemTypes';
import { User } from '../types/userTypes';

interface SaleItemCreationAttributes extends Optional<SaleItemAttributes, 'id'> {}

interface SaleItemAttributes {
    id: string;
    name: string;
    rate: number;
    categoryId: string; // Foreign key for SaleItemCategory
    booksRefId?: string; // Nullable field
    category?: SaleItemCategory; // Include the category
    createdBy?: string; // Nullable field
    updatedBy?: string; // Nullable field
    orgId: string; // New field for organization ID
}

class SaleItem extends Model<SaleItemAttributes, SaleItemCreationAttributes> implements SaleItemAttributes {
    public id!: string;
    public name!: string;
    public rate!: number;
    public categoryId!: string; // Foreign key for SaleItemCategory
    public booksRefId?: string; // Nullable field
    public category?: SaleItemCategory; // Include the category
    public createdBy?: string; // Nullable field
    public updatedBy?: string; // Nullable field
    public orgId!: string; // New field for organization ID

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    public static fromInput(input: SaleItemInput, user: User): SaleItemCreationAttributes {
        return ({
            name: input.name,
            rate: input.rate,
            categoryId: input.categoryId,
            booksRefId: input.booksRefId,
            createdBy: user.username,
            updatedBy: user.username,
            orgId: user.orgId, // New field for organization ID
        });
    }

    public static fromDBModel(dbObj: SaleItem): SaleItemInterface {
        return {
            id: dbObj.id.toString(),    
            name: dbObj.name,
            rate: dbObj.rate,
            categoryId: dbObj.categoryId,
            booksRefId: dbObj.booksRefId,
            category: dbObj.category ? SaleItemCategory.fromDBModel(dbObj.category) : undefined,    
        };
    }
}

SaleItem.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        rate: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
        },
        booksRefId: {
            type: DataTypes.STRING,
            allowNull: true,
            unique: true,
        },
        categoryId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: SaleItemCategory,
                key: 'id',
            },
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
            type: DataTypes.UUID,
            allowNull: false,
        },
    },
    {
        sequelize,
        tableName: 'SaleItems',
        indexes: [
            {
                unique: true,
                fields: ['name', 'orgId'], // Add unique constraint on name and orgId
            },
            {
                unique: true,
                fields: ['booksRefId', 'orgId'], // Add unique constraint on name and orgId
            },
        ],
    }
    
);

// Define the association
SaleItem.belongsTo(SaleItemCategory, { foreignKey: 'categoryId', as: 'category' });

 export default SaleItem;
