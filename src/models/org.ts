import { DataTypes, Model } from 'sequelize';
import sequelize from './database';
import { OrgConfiguration, WhatsappPhoneConfig, Org as OrgInterface } from '../types/orgTypes';
import logger from '../common/logger'; // Assuming you have a logger utility

interface OrgAttributes {
  id: string;
  name: string;
  configuration: OrgConfiguration;
  createdBy: string;
  updatedBy: string;
}

// Providing a specific interface for creation attributes
interface OrgCreationAttributes {
  name: string;
  configuration: OrgConfiguration;
  createdBy: string;
  updatedBy: string;
}

class Org extends Model<OrgAttributes, OrgCreationAttributes> implements OrgAttributes {
  public id!: string;
  public name!: string;
  public configuration!: OrgConfiguration;
  public createdBy!: string;
  public updatedBy!: string;
  

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  private static configurationCache: Map<string, { configuration: OrgConfiguration, timestamp: number }> = new Map();

  public static fromDBModel(org: Org): OrgInterface {
    return {
      id: org.id,
      name: org.name,
      configuration: org.configuration
    };
  }

  public static toDBCreate(input: Partial<OrgAttributes>, createdBy: string): OrgCreationAttributes {
    return {
      name: input.name!,
      configuration: input.configuration!,
      createdBy: createdBy,
      updatedBy: createdBy,
    };
  }

  public static async getConfiguration(orgId: string): Promise<OrgConfiguration | undefined> {
    logger.info(`Fetching configuration for orgId: ${orgId}`);
    const cacheEntry = this.configurationCache.get(orgId);
    const now = Date.now();

    if (cacheEntry && (now - cacheEntry.timestamp < 4 * 60 * 60 * 1000)) {
      logger.info(`Returning cached configuration for orgId: ${orgId}`);
      return cacheEntry.configuration;
    }

    await this.getAllOrgConfigs(true);
    const ret = this.configurationCache.get(orgId)?.configuration || undefined;
    logger.info(`Returning refreshed configuration for orgId: ${orgId}: %o`,ret);
    return ret;
  }

  public static async getAllOrgConfigs(forceRefresh: boolean = false): Promise<Map<string, OrgConfiguration>> {
    logger.info(`Fetching all org configurations with forceRefresh: ${forceRefresh}`);
    const now = Date.now();
    const configurations: Map<string, OrgConfiguration> = new Map();

    if (this.configurationCache.size === 0 || forceRefresh) {
      const orgs = await Org.findAll();
      for (const org of orgs) {
        const configuration = org.configuration;
        this.configurationCache.set(org.id, { configuration, timestamp: now });
        configurations.set(org.id, configuration);
      }
      logger.info(`Fetched and cached configurations for all orgs`);
    } else {
      for (const [orgId, cacheEntry] of this.configurationCache.entries()) {
        if (now - cacheEntry.timestamp < 4 * 60 * 60 * 1000) {
          configurations.set(orgId, cacheEntry.configuration);
        } else {
          const org = await Org.findByPk(orgId);
          if (org) {
            const configuration = org.configuration;
            this.configurationCache.set(orgId, { configuration, timestamp: now });
            configurations.set(orgId, configuration);
          }
        }
      }
      logger.info(`Returned configurations from cache`);
    }

    return configurations;
  }

  public static async getWhatsAppConfig(phoneNumber: string): Promise<{ config: WhatsappPhoneConfig, orgId: string } | undefined> {
    logger.info(`Fetching WhatsApp configuration for phoneNumber: ${phoneNumber}`);
    const orgConfigs = await this.getAllOrgConfigs();
    for (const [orgId, config] of orgConfigs) {
      const whatsappConfig = config.whatsapp;
      if (whatsappConfig) {
        const phoneConfig = whatsappConfig.phoneconfig?.find((config: WhatsappPhoneConfig) => config.phoneNumber === phoneNumber);
        if (phoneConfig) {
          logger.info(`Found WhatsApp configuration for phoneNumber: ${phoneNumber} in orgId: ${orgId}`);
          return { config: phoneConfig, orgId };
        }
      }
    }
    logger.warn(`No WhatsApp configuration found for phoneNumber: ${phoneNumber}`);
    return undefined;
  }
}

Org.init(
  {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        allowNull: false,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      createdBy: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      updatedBy: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      configuration: {
        type: DataTypes.JSON,
        allowNull: false,
      },
  },
  {
    sequelize,
    tableName: 'Orgs',
  }
);

export default Org;
