import { DataTypes, Model, Optional } from 'sequelize';
import moment from 'moment';
import { CustomerInput, Customer as CustomerInterface } from '../types/customerTypes';
import sequelize from './database'; // Import sequelize instance
import Branch from './branch'; // Import Branch model
import { User } from '../types/userTypes';
import { Channel, Endpoint } from '../types/commTypes';
import EndpointModel from './endpoint';

export interface CustomerAttributes {
    id: string; // Change id to string for UUID
    mobile: string;
    name: string;
    email: string | undefined; // Nullable
    city: string | undefined; // Nullable
    postalCode: string;
    address: string | undefined; // Nullable
    booksRefId: string | undefined; // Change type to string and make nullable
    defaultBranchId: string | undefined; // Change type to number and make nullable
    dateOfBirth: Date | undefined; // Nullable
    orgId: string; // Make orgId mandatory
    createdBy: string;
    updatedBy: string;
    gender: 'm' | 'f' | 'u'; 
}

interface CustomerCreationAttributes extends Optional<CustomerAttributes, 'id'> {}

class Customer extends Model<CustomerAttributes, CustomerCreationAttributes> implements CustomerAttributes {
    public id!: string; // Change id to string for UUID
    public mobile!: string;
    public name!: string;
    public email!: string | undefined;
    public city!: string | undefined;
    public postalCode!: string;
    public address!: string | undefined;
    public booksRefId!: string | undefined; // Change type to string and make nullable
    public defaultBranchId!: string | undefined; // Change type to number and make nullable
    public dateOfBirth!: Date | undefined; // Nullable
    public orgId!: string; // Make orgId mandatory
    public createdBy!: string;
    public updatedBy!: string;
    public gender!: 'm' | 'f' | 'u';  

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    public static mapDBModel2Interface(customer: Customer): CustomerInterface {
        const customerInterface: CustomerInterface = {
            id: customer.id,
            name: customer.name,
            mobile: customer.mobile,
            postalCode: customer.postalCode,
            gender: customer.gender,
        };

        if (customer.email) customerInterface.email = customer.email;
        if (customer.city) customerInterface.city = customer.city;
        if (customer.address) customerInterface.address = customer.address;
        if (customer.booksRefId) customerInterface.booksRefId = customer.booksRefId;
        if (customer.defaultBranchId) customerInterface.defaultBranchId = customer.defaultBranchId;
        if (customer.dateOfBirth) customerInterface.dateOfBirth = customer.dateOfBirth.toString();

        return customerInterface;
    }

    public static mapInterface2DBModel(input: CustomerInput, user: User): CustomerCreationAttributes {
        return {
            name: input.name,
            email: input.email,
            mobile: input.mobile,
            city: input.city,
            postalCode: input.postalCode,
            address: input.address,
            booksRefId: input.booksRefId,
            defaultBranchId: input.defaultBranchId,
            dateOfBirth: input.dateOfBirth ? (() => {
            const [year, month, day] = input.dateOfBirth.split('T')[0].split('-').map(Number);
            return new Date(year, month - 1, day);
            })() : undefined,
            orgId: user.orgId, // Add orgId mapping
            createdBy: user.username,
            updatedBy: user.username,
            gender: input.gender, 
        };
    }

    public async getWhatsappEndpoint(): Promise<Endpoint> {
        const endpoint = await EndpointModel.findOrCreateByExternalId(this.orgId, this.mobile, Channel.whatsapp, this.mobile);
        return endpoint;
    }
}

Customer.init(
    {
        id: {
            type: DataTypes.UUID, // Change type to UUID
            defaultValue: DataTypes.UUIDV4, // Use UUIDV4 for default value
            primaryKey: true,
        },
        mobile: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        email: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        city: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        postalCode: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        address: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        booksRefId: {
            type: DataTypes.STRING, // Change type to string and make nullable
            allowNull: true,
        },
        defaultBranchId: {
            type: DataTypes.UUID, // Change type to number and make nullable
            allowNull: true,
            references: {
                model: Branch,
                key: 'id'
            }
        },
        dateOfBirth: {
            type: DataTypes.DATEONLY, // Add dateOfBirth field
            allowNull: true,
            get: function() {
                return this.getDataValue('dateOfBirth') == null? null : moment.utc(this.getDataValue('dateOfBirth')).format('YYYY-MM-DD');
            }
        },
        orgId: {
            type: DataTypes.STRING, // Add orgId field
            allowNull: false, // Make orgId mandatory
        },
        createdBy: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        updatedBy: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        gender: {
            type: DataTypes.ENUM('m', 'f', 'u'),
            allowNull: false,
            defaultValue: 'm' 
        },
    },
    {
        sequelize,
        tableName: 'Customers',
        indexes: [
            {
                unique: true,
                fields: ['mobile', 'orgId']
            },
            {
                unique: true,
                fields: ['booksRefId', 'orgId']
            }
        ]
    }
);

export default Customer;
