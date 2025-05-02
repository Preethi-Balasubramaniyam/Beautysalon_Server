import { Model, DataTypes, Optional } from 'sequelize';
import sequelize from './database'; // Adjust the import based on your setup
import Customer from './customer'; // Ensure the file './Customers.ts' exists in the same directory
import Invoice from './invoice'; // Adjust the import based on your setup
import { PaymentMode, CustomerPayment as CustomerPaymentInterface, CustomerPaymentInput } from '../types/invoiceTypes';

interface CustomerAttributes {
    id: string; // Add this line
    customerId: string;
    paymentMode: PaymentMode;
    amount: number;
    date: Date;
    customer?: Customer;
    invoice?: Invoice;
    invoiceId: string;
    createdBy: string;
    updatedBy: string;
    booksRefId?: string; // Add this line
}

interface CustomerCreationAttributes extends Optional<CustomerAttributes, 'id'> {} // Modify this line

class CustomerPayment extends Model<CustomerAttributes, CustomerCreationAttributes> implements CustomerAttributes {
    public id!: string; // Add this line
    public customerId!: string;
    public paymentMode!: PaymentMode;
    public amount!: number;
    public date!: Date;
    public invoice?: Invoice; // Add this line
    public customer?: Customer;;
    public invoiceId!: string;
    public createdBy!: string;
    public updatedBy!: string;
    public booksRefId?: string; // Add this line

    // timestamps!
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    public static toDBModelCreation(input: CustomerPaymentInput,customerId :string,invoiceId:string,createdBy:string): CustomerCreationAttributes {
        return {
            customerId: customerId,
            paymentMode: input.paymentMode,
            amount: input.amount,
            date: new Date(input.date),
            invoiceId: invoiceId,
            createdBy: createdBy,
            updatedBy: createdBy
        };

    }

    public static fromDBModel(payment: CustomerPayment): CustomerPaymentInterface {
        return {
            id: payment.id,
            customerId: payment.customerId,
            paymentMode: payment.paymentMode,
            amount: payment.amount,
            date: payment.date.toISOString().split('T')[0],
            invoiceId: payment.invoiceId,
            booksRefId: payment.booksRefId
        };
    }
}

CustomerPayment.init({
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    customerId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: Customer, // name of the related table
            key: 'id'
        }
    },
    paymentMode: {
        type: DataTypes.ENUM,
        values: Object.values(PaymentMode),
        allowNull: false
    },
    amount: {
        type: DataTypes.FLOAT,
        allowNull: false
    },
    date: {
        type: DataTypes.DATE,
        allowNull: false
    },
    invoiceId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: Invoice, // name of the related table
            key: 'id'
        }
    },
    createdBy: {
        type: DataTypes.STRING,
        allowNull: false
    },
    updatedBy: {
        type: DataTypes.STRING,
        allowNull: false
    },
    booksRefId: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    sequelize,
    tableName: 'CustomerPayments',
    timestamps: false
});

CustomerPayment.belongsTo(Customer, {foreignKey: 'customerId', as: 'customer' });

export default CustomerPayment;