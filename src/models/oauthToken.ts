import { DataTypes, Model } from 'sequelize';
import sequelize from './database';
import User from './user';

class OAuthToken extends Model {
    public accessToken!: string;
    public accessTokenExpiresAt!: Date;
    public refreshToken!: string;
    public refreshTokenExpiresAt!: Date;
    public clientId!: string;
    public userId!: number;
    public grants!: string[];
}

OAuthToken.init({
    accessToken: {
        type: DataTypes.STRING,
        primaryKey: true,
    },
    accessTokenExpiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
    },
    refreshToken: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    refreshTokenExpiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
    },
    clientId: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: User,
            key: 'id',
        },
    },
    grants: {
        type: DataTypes.JSON,
        allowNull: false,
    },
}, {
    sequelize,
    tableName: 'OAuthTokens',
});

User.hasMany(OAuthToken, { foreignKey: 'userId' });
OAuthToken.belongsTo(User, { foreignKey: 'userId' });

export default OAuthToken;