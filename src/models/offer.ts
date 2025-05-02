import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from './database';
import SaleItem from './saleItem'; // Import SaleItem
import { OfferInput, Offer as OfferInterface } from '../types/offerTypes';
import { User } from '../types/userTypes';

interface OfferAttributes {
    id: string;
    name: string;
    rate: number;
    saleItems?: SaleItem[]; // List of SaleItems (optional)
    createdBy?: string; // Nullable field
    updatedBy?: string; // Nullable field
}

interface OfferCreationAttributes extends Optional<OfferAttributes, 'id'> {}

class Offer extends Model<OfferAttributes, OfferCreationAttributes> implements OfferAttributes {
    public id!: string;
    public name!: string;
    public rate!: number;
    public saleItems?: SaleItem[]; // List of SaleItems (optional)
    public createdBy?: string; // Nullable field
    public updatedBy?: string; // Nullable field

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    public static fromInput(input: OfferInput, user: User): OfferCreationAttributes {
        return {
            name: input.name,
            rate: input.rate,
            createdBy: user.username,
            updatedBy: user.username,
        };
    }

    public static fromDBModel(dbObj: Offer): OfferInterface {
        return {
            id: dbObj.id.toString(),
            name: dbObj.name,
            rate: dbObj.rate,
            saleItems: dbObj.saleItems ? dbObj.saleItems.map((item: SaleItem) => SaleItem.fromDBModel(item)) : [],
        };
    }
}

Offer.init(
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
        createdBy: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        updatedBy: {
            type: DataTypes.STRING,
            allowNull: true,
        },
    },
    {
        sequelize,
        tableName: 'Offers',
    }
);

// Define the association
Offer.belongsToMany(SaleItem, { through: 'OfferSaleItemMap', as: 'saleItems', foreignKey: 'offerId' });
SaleItem.belongsToMany(Offer, { through: 'OfferSaleItemMap', as: 'offers', foreignKey: 'saleItemId' });

export default Offer;

// Define the OfferSaleItemMap model
class OfferSaleItemMap extends Model {
    public offerId!: string;
    public saleItemId!: string;
}

OfferSaleItemMap.init(
    {
        offerId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: Offer,
                key: 'id',
            },
        },
        saleItemId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: SaleItem,
                key: 'id',
            },
        },
    },
    {
        sequelize,
        tableName: 'OfferSaleItemMap',
    }
);

export { OfferSaleItemMap };
