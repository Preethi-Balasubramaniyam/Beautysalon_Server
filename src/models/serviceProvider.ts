import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from './database';
import Branch from './branch'; // Import the Branch model
import { ServiceProvider as ServiceProviderInterface, CreateServiceProviderRequest } from '../types/serviceProviderTypes';
import { User } from '../types/userTypes';

interface ServiceProviderAttributes {
    id: string;
    name: string;
    email?: string;
    mobile: string;
    branchId: string; // Change branch to branchId
    branch?: Branch;
    status: 'Active' | 'InActive';
    booksRefId?: string;
    experience?: number;
    createdBy: string;
    updatedBy: string;
    orgId: string;
}

interface ServiceProviderCreationAttributes extends Optional<ServiceProviderAttributes, 'id'> {}

class ServiceProvider extends Model<ServiceProviderAttributes, ServiceProviderCreationAttributes> implements ServiceProviderAttributes {
    public id!: string;
    public name!: string;
    public email!: string;
    public mobile!: string;
    public branchId!: string; // Change branch to branchId
    public branch?: Branch;
    public status!: 'Active' | 'InActive';
    public booksRefId!: string;
    public experience!: number;
    public createdBy!: string;
    public updatedBy!: string;
    public orgId!: string;

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    public static fromDBModel(dbModel: ServiceProvider): ServiceProviderInterface {
        return {
            id: dbModel.id.toString(),
            name: dbModel.name,
            email: dbModel.email,
            mobile: dbModel.mobile,
            branchId: dbModel.branchId.toString(),
            branch: dbModel.branch ? Branch.fromDBModel(dbModel.branch) : undefined,
            booksRefId: dbModel.booksRefId,
            status: dbModel.status as 'Active' | 'InActive',
            experience: dbModel.experience,
        };
    }

    public static toDBModelForCreate(model: CreateServiceProviderRequest, user:User): ServiceProviderCreationAttributes {
        return {
            name: model.name,
            email: model.email,
            mobile: model.mobile,
            branchId: model.branchId,
            booksRefId: model.booksRefId,
            status: model.status as 'Active' | 'InActive',
            experience: model.experience,
            createdBy: user.username,
            updatedBy: user.username,
            orgId: user.orgId,
        };
    }
}

ServiceProvider.init(
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
        email: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        mobile: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        branchId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: Branch, // Link to Branch model
                key: 'id',
            },
        },
        status: {
            type: DataTypes.ENUM('Active', 'InActive'),
            defaultValue: 'Active',
            allowNull: false,
        },
        booksRefId: {
            type: DataTypes.STRING,
            allowNull: true,
            unique: true,
        },
        experience: {
            type: DataTypes.INTEGER,
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
        orgId: {
            type: DataTypes.STRING,
            allowNull: false,
        },
    },
    {
        sequelize,
        tableName: 'ServiceProviders',
        indexes: [
            {
                unique: true,
                fields: ['mobile', 'orgId']
            },
            {
                unique: true,
                fields: ['booksRefId', 'orgId']
            },
            {
                unique: true,
                fields: ['name', 'branchId', 'orgId']
            }
        ]
    }
);

// Define the many-to-one relationship with Branch
ServiceProvider.belongsTo(Branch, {
    foreignKey: 'branchId',
    as: 'branch'
});

export default  ServiceProvider;