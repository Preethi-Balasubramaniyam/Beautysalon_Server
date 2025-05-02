import { Sequelize } from 'sequelize';
import config from 'config';
import logger from '../common/logger';
import mysql from 'mysql2/promise';

const env = process.env.NODE_ENV || 'development';

let sequelize: Sequelize;

if (env === 'test') {
    sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: ':memory:',
        //logging: (msg) => console.log(msg), // Enable logging
        logging: false,
    });
} else {
    const DB_HOST = process.env.RDS_HOSTNAME || config.get('database.host');
    const DB_PORT = process.env.RDS_PORT || config.get('database.port');
    const DB_NAME = process.env.RDS_DB_NAME || config.get('database.name');
    const DB_USERNAME = process.env.RDS_USERNAME || config.get('database.username');
    const DB_PASSWORD = process.env.RDS_PASSWORD || config.get('database.password');
    if (!DB_HOST || !DB_PORT || !DB_NAME || !DB_USERNAME || !DB_PASSWORD) {
        logger.error('Database configuration is missing');
        throw new Error('Database configuration is missing');
    }

    if (env === 'development') {
        logger.info('Creating database if it does not exist');
        interface MySqlConnectionConfig {
            host: string;
            port: number;
            user: string;
            password: string;
        }
        const connectionConfig: MySqlConnectionConfig = {
            host: DB_HOST,
            port: parseInt(DB_PORT),
            user: DB_USERNAME,
            password: DB_PASSWORD
        };

        mysql.createConnection(connectionConfig).then((connection) => {
            return connection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`;`)
                .then(() => {
                    logger.info(`Database ${DB_NAME} created or already exists`);
                })
                .catch((err: Error) => {
                    logger.error('Error creating database:', err);
            }).finally(() => {
                connection.end();
            });
        }).catch((err: Error) => {
            logger.error('Unable to connect to MySQL server:', err);
        });
    }

    sequelize = new Sequelize(DB_NAME, DB_USERNAME, DB_PASSWORD, {
        host: DB_HOST,
        port: parseInt(DB_PORT),
        dialect: 'mysql',
        //logging: (msg) => logger.debug(msg), // Enable logging
        logging: false,
    });
    logger.info(`Using MySQL database at ${DB_HOST}:${DB_PORT}/${DB_NAME}`);
}

export default sequelize;
