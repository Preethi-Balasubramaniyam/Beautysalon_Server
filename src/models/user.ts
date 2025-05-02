import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from './database';
import { RegisterInput, User as UserInterface } from '../types/userTypes';
import { UserRole, UserScope } from '../types/userTypes';
import ServiceProvider from './serviceProvider';
import Org from './org';

interface UserAttributes {
    id: string; // Change this line to use string for UUID
    username: string;
    password: string;
    role: UserRole;
    scope?: UserScope[];
    createdBy: string;
    updatedBy: string;
    name: string;
    mobile: string;
    email: string;
    serviceProviderId?: string | undefined;
    orgId: string; // Add this line
}

type UserCreationAttributes = Optional<UserAttributes, 'id'>;

class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
    public id!: string; // Change this line to use string for UUID
    public username!: string;
    public password!: string;
    public role!: UserRole;
    public scope!: UserScope[];
    public createdBy!: string;
    public updatedBy!: string;
    public name!: string;
    public mobile!: string;
    public email!: string;
    public orgId!: string; // Add this line
    public serviceProviderId?: string | undefined;


    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    public static fromDBModel(user: User): UserInterface {
        return {
            id: user.id,
            username: user.username,
            role: user.role,
            scope: user.scope,
            name: user.name,
            mobile: user.mobile,
            email: user.email,
            serviceProviderId: user.serviceProviderId,
            orgId: user.orgId,
        };
    }
    static roleToScope = (role: UserRole): UserScope[] => {
        switch (role) {
            case UserRole.Admin:
                return [UserScope.Admin, UserScope.Manager, UserScope.ReadOnlyUser, UserScope.ServiceProvider];
            case UserRole.Manager:
                return [UserScope.Manager, UserScope.ReadOnlyUser, UserScope.ServiceProvider];
            case UserRole.ServiceProvider:
                return [UserScope.ServiceProvider];
            case UserRole.ReadOnlyUser:
                return [UserScope.ReadOnlyUser];
            default:
                return [];
        }
    }
    public static toDBCreate(input: RegisterInput, createdBy: string, hashedPassword:string, orgId: string): UserCreationAttributes {
        return {
            username: input.username,
            password: hashedPassword,
            role: input.role,
            scope: User.roleToScope(input.role),
            name: input.name,
            mobile: input.mobile,
            email: input.email,
            createdBy: createdBy,
            updatedBy: createdBy,
            serviceProviderId: input.serviceProviderId,
            orgId: orgId
        };
    }
}

User.init({
    id: {
        type: DataTypes.UUID, // Change this line to use UUID
        defaultValue: DataTypes.UUIDV4, // Add this line to generate UUID automatically
        primaryKey: true,
    },
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    role: {
        type: DataTypes.ENUM(...Object.values(UserRole)),
        allowNull: false,
    },
    scope: {
        type: DataTypes.JSON, // Use JSON type for MySQL
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
    name: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    mobile: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    email: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    serviceProviderId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: ServiceProvider,
            key: 'id'
        }
    },
    orgId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: Org,
            key: 'id'
        }
    },
}, {
    sequelize,
    tableName: 'Users',
    timestamps: true,
});

export default User;