import { DataTypes, Model } from 'sequelize';
import sequelize from './database';

class OTP extends Model {
    id!: string; 
    mobile_number!: string;
    user_id!: string; 
    otp!: string;
    expiry_time!: Date;
    attempt_count!: number;
    resend_count!: number;
    last_sent_time!: Date;
}

OTP.init(
    {
        id: {
            type: DataTypes.UUID, 
            defaultValue: DataTypes.UUIDV4, 
            primaryKey: true,
        },
        mobile_number: {
            type: DataTypes.STRING(20),
            allowNull: false,
        },
        user_id: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: 'Users', 
                key: 'id',
            },
        },
        otp: {
            type: DataTypes.STRING(6),
            allowNull: false,
        },
        expiry_time: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        attempt_count: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },
        resend_count: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },
        last_sent_time: {
            type: DataTypes.DATE,
            allowNull: false,
        },
    },
    {
        sequelize,
        modelName: 'OTP',
        tableName: 'otp',
        timestamps: false,
    }
);

export default OTP;
