import { QueryInterface, DataTypes, Model } from 'sequelize';
import { OrgConfiguration, WhatsappConfiguration, InstagramConfiguration } from '../types/orgTypes';

interface OrgMapping {
  oldId: string;
  newId: string;
}

interface OrgRecord {
  id: string;
  name?: string;
  configuration: string | OrgConfiguration;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface OrgAttributes {
  id: string;
  name: string;
  configuration: OrgConfiguration;
  createdBy: string;
  updatedBy: string;
}

interface OldOrgAttributes {
  id: string;
  configuration: OrgConfiguration;
  createdBy: string;
  updatedBy: string;
}

interface OrgCreationAttributes {
  name: string;
  configuration: OrgConfiguration;
  createdBy: string;
  updatedBy: string;
}

class Org extends Model<OrgAttributes, OrgCreationAttributes> {
  public id!: string;
  public name!: string;
  public configuration!: OrgConfiguration;
  public createdBy!: string;
  public updatedBy!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

class OldOrg extends Model<OldOrgAttributes, OldOrgAttributes> {
  public id!: string;
  public configuration!: OrgConfiguration;
  public createdBy!: string;
  public updatedBy!: string;
}

export async function up(queryInterface: QueryInterface): Promise<void> {
  try {
    // Try to remove the Users constraint, but don't fail if it doesn't exist
    await queryInterface.removeConstraint('Users', 'Users_ibfk_2');
  } catch (error) {
    // Ignore error if constraint doesn't exist
    if (!(error instanceof Error) || !error.message.includes('does not exist')) {
      throw error;
    }
  }

  // Drop temporary table if it exists
  try {
    console.log('Dropping temporary table if it exists');
    await queryInterface.dropTable('Orgs_temp');
    console.log('Temporary table dropped');
  } catch (error) {
    // Ignore error if table doesn't exist
    if (!(error instanceof Error) || !error.message.includes('does not exist')) {
      throw error;
    }
  }

  console.log('Getting existing data');
  // First, get the existing data to inspect it
  const [results] = await queryInterface.sequelize.query('SELECT * FROM Orgs');
  const existingOrgs = results as OrgRecord[];
  console.log('Existing data retrieved');

  // Create a temporary table with the new schema
  await queryInterface.createTable('Orgs_temp', {
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
    configuration: {
      type: DataTypes.JSON,
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
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  });
  console.log('Temporary table created');

  // Initialize the model with the temporary table
  Org.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    configuration: {
      type: DataTypes.JSON,
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
  }, {
    sequelize: queryInterface.sequelize,
    tableName: 'Orgs_temp',
    timestamps: true,
  });
  console.log('Model initialized');

  // Process each row individually to handle JSON conversion
  for (const org of existingOrgs) {
    try {
      console.log('Processing org:', org.id);
      let configuration: OrgConfiguration;
      
      // Try to parse the configuration if it's a string
      if (typeof org.configuration === 'string') {
        console.log('Parsing string configuration');
        configuration = JSON.parse(org.configuration);
      } else {
        console.log('Using existing configuration object');
        configuration = org.configuration;
      }

      // Ensure configuration is properly structured
      if (!configuration) {
        configuration = {};
      }
      if (!configuration.whatsapp) {
        configuration.whatsapp = {
          chatEndpoints: [],
          phoneconfig: []
        } as WhatsappConfiguration;
      }
      if (!configuration.instagram) {
        configuration.instagram = {
          authToken: '',
          businessAccountId: ''
        } as InstagramConfiguration;
      }

      console.log('Creating new record');
      // Create a new record using the model
      const newOrg = await Org.create({
        name: org.id,
        configuration,
        createdBy: org.createdBy,
        updatedBy: org.updatedBy,
      });
      console.log('Record created successfully:', newOrg.id);
    } catch (error) {
      console.error('Error processing org:', org.id);
      console.error('Error details:', error);
      throw error;
    }
  }

  console.log('All records processed');
  
  // Store the mapping of old IDs to new IDs before dropping the old table
  const [orgMappings] = await queryInterface.sequelize.query(`
    SELECT o.id as oldId, n.id as newId 
    FROM Orgs o 
    JOIN Orgs_temp n ON o.id = n.name
  `) as [OrgMapping[], unknown];
  console.log('Retrieved org ID mappings');

  // Drop the old table
  try {
    console.log('Dropping old table');
    await queryInterface.dropTable('Orgs');
    console.log('Old table dropped');
  } catch (error) {
    console.error('Error dropping old table:', error);
    throw error;
  }

  // Rename the temporary table to the original name
  await queryInterface.renameTable('Orgs_temp', 'Orgs');
  console.log('Temporary table renamed');

  // Update Users.orgId to match new UUIDs
  for (const mapping of orgMappings) {
    try {
      console.log(`Updating Users.orgId from ${mapping.oldId} to ${mapping.newId}`);
      await queryInterface.sequelize.query(`
        UPDATE Users 
        SET orgId = :newId 
        WHERE orgId = :oldId
      `, {
        replacements: { newId: mapping.newId, oldId: mapping.oldId }
      });
    } catch (error) {
      console.error(`Error updating Users.orgId for org ${mapping.oldId}:`, error);
      throw error;
    }
  }
  console.log('Updated all Users.orgId values');

  // Modify Users.orgId column to match Orgs.id type
  try {
    console.log('Modifying Users.orgId column type to UUID');
    await queryInterface.changeColumn('Users', 'orgId', {
      type: DataTypes.UUID,
      allowNull: false
    });
    console.log('Users.orgId column type modified successfully');
  } catch (error) {
    console.error('Error modifying Users.orgId column:', error);
    throw error;
  }

  // Recreate the Users foreign key constraint
  try {
    console.log('Recreating Users foreign key constraint');
    await queryInterface.addConstraint('Users', {
      fields: ['orgId'],
      type: 'foreign key',
      name: 'Users_ibfk_2',
      references: {
        table: 'Orgs',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
    console.log('Users foreign key constraint recreated');
  } catch (error) {
    console.error('Error recreating Users foreign key constraint:', error);
    throw error;
  }
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  try {
    // Try to remove the Users constraint, but don't fail if it doesn't exist
    await queryInterface.removeConstraint('Users', 'Users_ibfk_2');
  } catch (error) {
    // Ignore error if constraint doesn't exist
    if (!(error instanceof Error) || !error.message.includes('does not exist')) {
      throw error;
    }
  }

  // Drop temporary table if it exists
  try {
    console.log('Dropping temporary table if it exists');
    await queryInterface.dropTable('Orgs_temp');
    console.log('Temporary table dropped');
  } catch (error) {
    // Ignore error if table doesn't exist
    if (!(error instanceof Error) || !error.message.includes('does not exist')) {
      throw error;
    }
  }

  // First, get the existing data to inspect it
  const [results] = await queryInterface.sequelize.query('SELECT * FROM Orgs');
  const existingOrgs = results as OrgRecord[];

  // Create a temporary table with the old schema
  await queryInterface.createTable('Orgs_temp', {
    id: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true,
    },
    configuration: {
      type: DataTypes.JSON,
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
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  });

  // Initialize the model with the temporary table
  OldOrg.init({
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    configuration: {
      type: DataTypes.JSON,
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
  }, {
    sequelize: queryInterface.sequelize,
    tableName: 'Orgs_temp',
    timestamps: true,
  });

  // Process each row individually to handle JSON conversion
  for (const org of existingOrgs) {
    try {
      let configuration: OrgConfiguration;
      
      // Try to parse the configuration if it's a string
      if (typeof org.configuration === 'string') {
        configuration = JSON.parse(org.configuration);
      } else {
        configuration = org.configuration;
      }

      // Ensure configuration is properly structured
      if (!configuration) {
        configuration = {};
      }
      if (!configuration.whatsapp) {
        configuration.whatsapp = {
          chatEndpoints: [],
          phoneconfig: []
        } as WhatsappConfiguration;
      }
      if (!configuration.instagram) {
        configuration.instagram = {
          authToken: '',
          businessAccountId: ''
        } as InstagramConfiguration;
      }

      // Create a new record using the model
      await OldOrg.create({
        id: org.name || '',
        configuration,
        createdBy: org.createdBy,
        updatedBy: org.updatedBy,
      });
    } catch (error) {
      console.error('Error processing org:', org.id);
      console.error('Error details:', error);
      throw error;
    }
  }

  // Drop the new table
  try {
    console.log('Dropping new table');
    await queryInterface.dropTable('Orgs');
    console.log('New table dropped');
  } catch (error) {
    console.error('Error dropping new table:', error);
    throw error;
  }

  // Rename the temporary table to the original name
  await queryInterface.renameTable('Orgs_temp', 'Orgs');
  console.log('Temporary table renamed');

  // Recreate the Users foreign key constraint
  try {
    console.log('Recreating Users foreign key constraint');
    await queryInterface.addConstraint('Users', {
      fields: ['orgId'],
      type: 'foreign key',
      name: 'Users_ibfk_2',
      references: {
        table: 'Orgs',
        field: 'id'
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE'
    });
    console.log('Users foreign key constraint recreated');
  } catch (error) {
    console.error('Error recreating Users foreign key constraint:', error);
    throw error;
  }
} 