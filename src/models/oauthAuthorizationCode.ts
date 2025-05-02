
import { DataTypes, Model } from 'sequelize';
import sequelize from './database';
import User from './user';

class OAuthAuthorizationCode extends Model {
    public authorizationCode!: string;
    public expiresAt!: Date;
    public redirectUri!: string;
    public clientId!: string;
    public userId!: number;
}

OAuthAuthorizationCode.init({
    authorizationCode: {
        type: DataTypes.STRING,
        primaryKey: true,
    },
    expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
    },
    redirectUri: {
        type: DataTypes.STRING,
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
}, {
    sequelize,
    tableName: 'OAuthAuthorizationCodes',
});

User.hasMany(OAuthAuthorizationCode, { foreignKey: 'userId' });
OAuthAuthorizationCode.belongsTo(User, { foreignKey: 'userId' });

export default OAuthAuthorizationCode;