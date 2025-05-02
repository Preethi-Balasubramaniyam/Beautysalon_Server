import { DataTypes, Model } from 'sequelize';
import sequelize from './database';
import {InvoiceSaleItem as InvoiceSaleItemInterface} from '../types/invoiceTypes';
import SaleItem from './saleItem';

export interface InvoiceSaleItemAttributes {
    invoiceId: string;
    itemId: string;
    rate: number;
    quantity: number;
    createdBy: string;
    updatedBy: string;
    saleItem?: SaleItem;
}

class InvoiceSaleItem extends Model<InvoiceSaleItemAttributes> implements InvoiceSaleItemAttributes {
    public invoiceId!: string;
    public rate!: number;
    public quantity!: number;
    public createdBy!: string;
    public updatedBy!: string;
    public itemId!: string;
    public saleItem?: SaleItem;

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    public static mapDBModel2Interface(instance: InvoiceSaleItem): InvoiceSaleItemInterface {
        return {
            itemId: instance.itemId,
            rate: instance.rate,
            quantity: instance.quantity,
            booksRefId: instance.saleItem?.booksRefId
        };
    }

    public static mapInterface2DBModel(instance: InvoiceSaleItemInterface, invoiceId: string,  createdBy: string): InvoiceSaleItemAttributes {
        return {
            invoiceId: invoiceId,
            itemId: instance.itemId,
            rate: instance.rate,
            quantity: instance.quantity,
            createdBy: createdBy,
            updatedBy: createdBy
        };
    }
}

InvoiceSaleItem.init(
    {
        invoiceId: {
            type: DataTypes.UUID,
            primaryKey: true,
        },
        itemId: {
            type: DataTypes.UUID,
            primaryKey: true,
        },
        rate: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
        },
        quantity: {
            type: DataTypes.INTEGER,
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
        tableName: 'InvoiceSaleItems',
    }
);

export  default InvoiceSaleItem;
