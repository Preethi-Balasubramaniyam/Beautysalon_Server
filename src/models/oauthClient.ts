import { DataTypes, Model } from 'sequelize';
import sequelize from './database';

class OAuthClient extends Model {
    public clientId!: string;
    public clientSecret!: string;
    public grants!: string[];
}

OAuthClient.init({
    clientId: {
        type: DataTypes.STRING,
        primaryKey: true,
    },
    clientSecret: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    grants: {
        type: DataTypes.JSON, // Change to JSON
        allowNull: false,
    },
}, {
    sequelize,
    tableName: 'OAuthClients',
});

export default OAuthClient;