import { Sequelize } from 'sequelize';
import config from 'config';
import { up } from '../src/migrations/20240501000000-update-orgid-references';
import path from 'path';
import fs from 'fs';

// Define interface for database config
interface DBConfig {
  host: string;
  port: string | number;
  database: string;
  username: string;
  password: string;
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let env = process.env.NODE_ENV || 'development';
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--env' && i + 1 < args.length) {
      env = args[i + 1];
      break;
    }
  }
  
  return { env };
}

async function runOrgIdMigration() {
  const { env } = parseArgs();
  console.log(`Starting the orgId reference update migration in ${env} environment`);
  
  // Get database configuration based on environment
  let dbConfig: DBConfig | undefined;
  
  // Try to get config from sequelize config file first
  const sequelizeConfigPath = path.resolve('config', 'database.json');
  if (fs.existsSync(sequelizeConfigPath)) {
    try {
      const sequelizeConfig = JSON.parse(fs.readFileSync(sequelizeConfigPath, 'utf-8'));
      dbConfig = sequelizeConfig[env] as DBConfig;
      console.log(`Using database configuration from ${sequelizeConfigPath} for ${env} environment`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`Error reading sequelize config: ${errorMessage}`);
    }
  }
  
  // Fallback to configuration from config module
  if (!dbConfig) {
    try {
      dbConfig = {
        host: config.get(`database.${env}.host`) || config.get('database.host'),
        port: config.get(`database.${env}.port`) || config.get('database.port'),
        database: config.get(`database.${env}.name`) || config.get('database.name'),
        username: config.get(`database.${env}.username`) || config.get('database.username'),
        password: config.get(`database.${env}.password`) || config.get('database.password')
      };
      console.log(`Using database configuration from config module for ${env} environment`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`Error getting config from config module: ${errorMessage}`);
      
      // Final fallback to environment variables
      dbConfig = {
        host: process.env.RDS_HOSTNAME || 'localhost',
        port: process.env.RDS_PORT || '3306',
        database: process.env.RDS_DB_NAME || 'ebdb',
        username: process.env.RDS_USERNAME || 'root',
        password: process.env.RDS_PASSWORD || ''
      };
      console.log('Using database configuration from environment variables');
    }
  }
  
  // Validate database configuration
  if (!dbConfig || !dbConfig.host || !dbConfig.port || !dbConfig.database || !dbConfig.username) {
    console.error('Database configuration is incomplete');
    console.error('Configuration:', JSON.stringify(dbConfig, null, 2));
    process.exit(1);
  }
  
  console.log(`Connecting to database ${dbConfig.database} at ${dbConfig.host}:${dbConfig.port}`);
  
  // Create Sequelize instance
  const sequelize = new Sequelize(dbConfig.database, dbConfig.username, dbConfig.password, {
    host: dbConfig.host,
    port: typeof dbConfig.port === 'string' ? parseInt(dbConfig.port) : dbConfig.port,
    dialect: 'mysql',
    logging: console.log,
  });
  
  try {
    // Test connection
    await sequelize.authenticate();
    console.log('Database connection has been established successfully.');
    
    // Run the migration directly with the imported function
    await up(sequelize.getQueryInterface(), sequelize);
    
    console.log('OrgId reference migration completed successfully');
  } catch (error) {
    console.error('Error during migration:', error);
    process.exit(1);
  } finally {
    // Close connection
    await sequelize.close();
    console.log('Database connection closed');
  }
}

// Run the script
runOrgIdMigration().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
}); 