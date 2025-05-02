import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from './database';
import { BranchCreateRequest, Branch as BranchInterface } from '../types/branchTypes';
import { Endpoint } from '../types/commTypes';
import { User } from '../types/userTypes';

interface BranchAttributes {
    id: string;
    name: string;
    postalCode: string;
    city: string;
    state: string;
    address: string;
    commEndpoints?: Endpoint[];
    booksRefId?: string;
    cashLedgerId?: string;
    bankLedgerId?: string;
    orgId: string;
    createdBy: string;
    updatedBy: string;
}

type BranchCreationAttributes = Optional<BranchAttributes, 'id'>;

class Branch extends Model<BranchAttributes, BranchCreationAttributes> implements BranchAttributes {
    public id!: string;
    public name!: string;
    public postalCode!: string;
    public city!: string;
    public state!: string;
    public address!: string;
    public commEndpoints?: Endpoint[];
    public booksRefId?: string | undefined;
    public cashLedgerId?: string | undefined;
    public bankLedgerId?: string | undefined;
    public orgId!: string;
    public createdBy!: string;
    public updatedBy!: string;

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    public static toDBCreateModel(input: BranchCreateRequest, user: User): BranchCreationAttributes {
        return {
            name: input.name,
            postalCode: input.postalCode!,
            city: input.city!,
            state: input.state!,
            address: input.address!,
            commEndpoints: input.commEndpoints!,
            cashLedgerId: input.cashLedgerId,
            bankLedgerId: input.bankLedgerId,
            orgId: user.orgId,
            createdBy: user.username,
            updatedBy: user.username,
        };
    }

    public static fromDBModel(branch: Branch): BranchInterface {
        return {
            id: branch.id.toString(),
            name: branch.name,
            postalCode: branch.postalCode,
            city: branch.city,
            state: branch.state,
            address: branch.address,
            commEndpoints: branch.commEndpoints,
            booksRefId: branch.booksRefId,
            cashLedgerId: branch.cashLedgerId,
            bankLedgerId: branch.bankLedgerId,
        };
    }
}

Branch.init(
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
        postalCode: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        city: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        state: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        address: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        commEndpoints: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        booksRefId: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        cashLedgerId: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        bankLedgerId: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        orgId: {
            type: DataTypes.UUID,
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
        tableName: 'Branches',
        timestamps: true,
        indexes: [
            {
                unique: true,
                fields: ['name', 'orgId'],
            },
            {
                unique: true,
                fields: ['booksRefId', 'orgId'],
            },
        ],
    }
);

export default Branch;
