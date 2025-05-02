import { Model, DataTypes, Optional } from 'sequelize';
import sequelize from './database';
import { IReport, ReportConfig } from '../types/reportTypes';

type ReportCreationAttributes = Optional<IReport, 'id' | 'updatedBy'>;

class Report extends Model<IReport, ReportCreationAttributes> implements IReport {
  public id!: string;
  public orgId!: string;
  public name!: string;
  public config!: ReportConfig;
  public pinned!: boolean;
  public createdBy!: string;
  public updatedBy?: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  // Converts the instance into a DB model format
  public static toDBModel(report: IReport): ReportCreationAttributes {
    return {
      id: report.id || undefined, // Allow undefined for auto-generated IDs
      orgId: report.orgId,
      name: report.name,
      config: report.config,
      pinned: report.pinned,
      createdBy: report.createdBy,
      updatedBy: report.updatedBy, // Ensure updatedBy can be null
      createdAt: report.createdAt,
      updatedAt: report.updatedAt
    };
  }

  // Converts from a DB model instance back to the TypeScript interface format
  public static fromDBModel(dbModel: Report): IReport {
    return {
      id: dbModel.id,
      orgId: dbModel.orgId,
      name: dbModel.name,
      config: dbModel.config,
      pinned: dbModel.pinned,
      createdBy: dbModel.createdBy,
      updatedBy: dbModel.updatedBy,
      createdAt: dbModel.createdAt,
      updatedAt: dbModel.updatedAt
    };
  }
}

Report.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    orgId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    config: {
      type: DataTypes.JSON,
      allowNull: false
    },
    pinned: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false
    },
    createdBy: {
      type: DataTypes.UUID,
      allowNull: false
    },
    updatedBy: {
      type: DataTypes.UUID,
      allowNull: true
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
    sequelize,
    tableName: 'Reports',
    indexes: [
      {
        fields: ['orgId', 'name']
      }
    ]
  }
);

export default Report;
