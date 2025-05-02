import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from './database';
import Customer from './customer';
import ServiceProvider from './serviceProvider';
import SaleItem from './saleItem';
import Branch from './branch'; // Add this import
import DBInvoiceSaleItem  from './invoiceSaleItem'; // Add this import
import CustomerPayment from './customerPayment'; // Add this import
import {Invoice as InvoiceInterface, InvoiceInput, Discount } from '../types/invoiceTypes';
import { User } from '../types/userTypes';

interface InvoiceAttributes {
    id: string;
    date: Date;
    serviceProviderId: string;
    customerId: string;
    branchId: string;
    total: number; // Make total optional
    booksRefId?: string;
    customerInvoiceNumber?: string; // Add this field
    invoiceSaleItems?: DBInvoiceSaleItem[];
    payments?: CustomerPayment[]; // Add this field
    saleItems?: SaleItem[]; // Add this field
    discounts?: Discount[]; // Add this field
    customer?: Customer;
    serviceProvider?: ServiceProvider;
    branch?: Branch;
    createdBy: string;
    updatedBy: string;
    orgId: string; // Add this field
    roundOff?: number; // Add this field
    metaData?: {
        booksInvoiceJson?: string;
        invoice_number?: string;
    }; // Add this field
}

interface InvoiceCreationAttributes extends Optional<InvoiceAttributes, 'id'> {}

class Invoice extends Model<InvoiceAttributes, InvoiceCreationAttributes> implements InvoiceAttributes {
    public id!: string;
    public date!: Date;
    public serviceProviderId!: string;
    public customerId!: string;
    public branchId!: string;
    public total!: number; // Make total optional
    public discounts?: Discount[];
    public payments?: CustomerPayment[] ;
    public booksRefId?: string;
    public customerInvoiceNumber?: string; // Add this field
    public invoiceSaleItems?: DBInvoiceSaleItem[];
    public saleItems?: SaleItem[];
    public customer?: Customer;
    public serviceProvider?: ServiceProvider;
    public branch?: Branch;
    public createdBy!: string;
    public updatedBy!: string;
    public orgId!: string; // Add this field
    public roundOff?: number; // Add this field
    public metaData?: {
        booksInvoiceJson?: string;
        invoice_number?: string;
    }; // Add this field

    // Virtual fields
    public get month(): number {
        return this.date.getMonth() + 1;
    }

    public get year(): number {
        return this.date.getFullYear();
    }

    public get day(): number {
        return this.date.getDate();
    }

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    //Making this private so that it returns full invoice all the time. 
    private static mapDBModel2Interface(instance: Invoice) : InvoiceInterface {
        return {
            id: instance.id,
            date: instance.date.toISOString().split('T')[0],
            serviceProviderId: instance.serviceProviderId,
            customerId: instance.customerId,
            branchId: instance.branchId,
            total: instance.total,
            discounts: instance.discounts,
            payments: instance.payments?.map(payment => (CustomerPayment.fromDBModel(payment))) || [],
            booksRefId: instance.booksRefId,
            customerInvoiceNumber: instance.customerInvoiceNumber, // Add this field
            invoiceSaleItems: instance.invoiceSaleItems?.map(item => (DBInvoiceSaleItem.mapDBModel2Interface(item))) || [],
            customer: instance.customer ? Customer.mapDBModel2Interface(instance.customer): undefined,
            serviceProvider: instance.serviceProvider ? ServiceProvider.fromDBModel(instance.serviceProvider) : undefined,
            branch: instance.branch ? Branch.fromDBModel(instance.branch): undefined,
            roundOff: instance.roundOff, // Add this field
            metaData: instance.metaData, // Add this field
        };
    }

    public static mapInterface2DBModel(instance: InvoiceInput, total: number, user: User) : InvoiceCreationAttributes {
        return {
            date: new Date(instance.date),
            serviceProviderId: instance.serviceProviderId,
            customerId: instance.customerId,
            branchId: instance.branchId,
            booksRefId: instance.booksRefId,
            customerInvoiceNumber: instance.customerInvoiceNumber, // Add this field
            discounts: instance.discounts,
            total: total,
            createdBy: user.username,
            updatedBy: user.username,
            orgId: user.orgId, // Add this field
            roundOff: instance.roundOff, // Add this field
            metaData: instance.metaData, // Add this field
        };
    }

    public static async getFullInvoiceById(id: string, details: boolean, orgId: string): Promise<InvoiceInterface | null> {
        const invoice = await Invoice.findOne({
            where: { id, orgId },
            include: details ? [
                { model: DBInvoiceSaleItem, as: 'invoiceSaleItems', include: [{ model: SaleItem, as: 'saleItem' }] },
                { model: Customer, as: 'customer' },
                { model: Branch, as: 'branch' },
                { model: ServiceProvider, as: 'serviceProvider' },
                { model: CustomerPayment, as: 'payments' }
            ] : [
                { model: DBInvoiceSaleItem, as: 'invoiceSaleItems', include: [{ model: SaleItem, as: 'saleItem' }]  },
                { model: CustomerPayment, as: 'payments' }
            ]
        });
        return invoice ? Invoice.mapDBModel2Interface(invoice) : null;
    }

    public static async findAndCountAllFullInvoices(whereClause: any, offset: number, limit: number, sortBy: string | undefined, sortOrder: string | undefined): Promise<{count: number, rows: InvoiceInterface[]}> {
        const invoices = await Invoice.findAndCountAll({
            include: [
                { model: DBInvoiceSaleItem, as: 'invoiceSaleItems', include: [{ model: SaleItem, as: 'saleItem' }] },
                { model: Customer, as: 'customer' },
                { model: Branch, as: 'branch' },
                { model: ServiceProvider, as: 'serviceProvider' },
                { model: CustomerPayment, as: 'payments' }
            ],
            where: whereClause,
            order: sortBy ? [[sortBy, sortOrder?.toUpperCase() || 'ASC']] : undefined,
            limit: limit,
            offset: offset,
            subQuery: false
        });
        const invoiceOutput: InvoiceInterface[] = invoices.rows.map(invoice => (Invoice.mapDBModel2Interface(invoice)));
        return {count: invoices.count, rows: invoiceOutput};
    }
}


Invoice.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        date: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        serviceProviderId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        customerId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        branchId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        total: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true, // Make total optional
        },
        discounts: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        booksRefId: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        customerInvoiceNumber: {
            type: DataTypes.STRING,
            allowNull: true,
        }, // Add this field
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
        roundOff: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
        },
        metaData: {
            type: DataTypes.JSON,
            allowNull: true,
        }, // Add this field
    },
    {
        sequelize,
        tableName: 'Invoices',
    }
);

// Add the association
Invoice.belongsTo(Customer, { foreignKey: 'customerId', as: 'customer' });
Customer.hasMany(Invoice, { foreignKey: 'customerId', as: 'invoices' });

// Add the association
Invoice.belongsTo(ServiceProvider, { foreignKey: 'serviceProviderId', as: 'serviceProvider' });
ServiceProvider.hasMany(Invoice, { foreignKey: 'serviceProviderId', as: 'invoices' });

// Add the association
Invoice.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });
Branch.hasMany(Invoice, { foreignKey: 'branchId', as: 'invoices' });

CustomerPayment.belongsTo(Invoice, {foreignKey: 'invoiceId', as: 'invoice'});
Invoice.hasMany(CustomerPayment, {foreignKey: 'invoiceId', as: 'payments'});


// Define the many-to-many relationship
//Invoice.belongsToMany(SaleItem, { through: DBInvoiceSaleItem, foreignKey: 'invoiceId' });
//SaleItem.belongsToMany(Invoice, { through: DBInvoiceSaleItem, foreignKey: 'saleItemId' });
Invoice.hasMany(DBInvoiceSaleItem, { foreignKey: 'invoiceId', as: 'invoiceSaleItems' });
DBInvoiceSaleItem.belongsTo(Invoice, { foreignKey: 'invoiceId', as: 'invoice' });
SaleItem.hasMany(DBInvoiceSaleItem, { foreignKey: 'itemId', as: 'invoiceSaleItems' });
DBInvoiceSaleItem.belongsTo(SaleItem, { foreignKey: 'itemId', as: 'saleItem' });

export default Invoice;
