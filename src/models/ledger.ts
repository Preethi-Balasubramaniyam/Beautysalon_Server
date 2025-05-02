import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from './database';
import { LedgerType, Ledger as LedgerInterface, LedgerCreateRequest } from "../types/ledgerTypes";
import { User } from "../types/userTypes";

interface LedgerAttributes {
    id: string;
    name: string;
    type: LedgerType;
    booksRefId?: string;
    orgId: string;
    createdBy: string;
    updatedBy: string;
}

type LedgerCreationAttributes = Optional<LedgerAttributes, 'id'>;

class Ledger extends Model<LedgerAttributes, LedgerCreationAttributes>
    implements LedgerAttributes {
    public id!: string;
    public name!: string;
    public type!: LedgerType;
    public booksRefId?: string;
    public orgId!: string;
    public createdBy!: string;
    public updatedBy!: string;

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    public static async getBooksRefIdById(id: string): Promise<string | undefined> {
        const account = await Ledger.findByPk(id);
        return account ? account.booksRefId : undefined;
    }

    // Add toDBCreateModel and fromDBModel methods
    public static  mapInterface2DBModel(input: LedgerCreateRequest, createdBy: User): LedgerCreationAttributes {
        return {
            name: input.name,
            type: input.type,
            booksRefId: input.booksRefId,
            orgId: createdBy.orgId,
            createdBy: createdBy.username,
            updatedBy: createdBy.username,
        };
    };

    public static mapDBModel2Interface(account: Ledger): LedgerInterface {
        return {
            id: account.id,
            name: account.name,
            type: account.type,
            booksRefId: account.booksRefId
        };
    };
}

Ledger.init(
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
        type: {
            type: DataTypes.ENUM(...Object.values(LedgerType)), // Use enum values
            allowNull: false,
        },
        booksRefId: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        orgId: {
            type: DataTypes.STRING,
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
        tableName: 'Ledgers',
        indexes: [
            {
                unique: true,
                fields: ['name', 'orgId'], // Composite unique constraint
            },
            {
                unique: true,
                fields: ['booksRefId', 'orgId'], // Composite unique constraint
            },
        ],
    }
);

export default Ledger;