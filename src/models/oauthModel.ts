import { Token, Client, User, AuthorizationCode } from 'oauth2-server';
import bcrypt from 'bcryptjs';
import DBUser from './user';
import OAuthClient from './oauthClient';
import OAuthToken from './oauthToken';
import OAuthAuthorizationCode from './oauthAuthorizationCode';
import logger from '../common/logger';
import OTP from './otp';

const oauthModel = {
    getAccessToken: async (accessToken: string): Promise<Token | false> => {
        try {
            const token = await OAuthToken.findOne({ where: { accessToken } });
            if (!token) return false;
            const user = await DBUser.findByPk(token.userId);
            if (!user) throw new Error('User not found');
            return {
                accessToken: token.accessToken,
                accessTokenExpiresAt: token.accessTokenExpiresAt,
                client: { id: token.clientId, grants: token.grants },
                user: DBUser.fromDBModel(user),
            };
        } catch (error) {
            logger.error('Database error in getAccessToken:', { error });
            throw new Error('Database error');
        } 
    },
    getClient: async (clientId: string, clientSecret: string): Promise<Client | false> => {
        try {
            const client = await OAuthClient.findOne({ where: { clientId, clientSecret } });
            if (!client) return false;
            return {
                id: client.clientId,
                grants: client.grants,
            };
        } catch (error) {
            logger.error('Database error in getClient:', { error });
            throw new Error('Database error');
        } 
    },
    saveToken: async (token: Token, client: Client, user: User): Promise<Token | false> => {
        logger.debug('saveToken called', { token, client, user });
        try {
            await OAuthToken.create({
                accessToken: token.accessToken,
                accessTokenExpiresAt: token.accessTokenExpiresAt,
                refreshToken: token.refreshToken,
                refreshTokenExpiresAt: token.refreshTokenExpiresAt,
                clientId: client.id,
                userId: user.id,
                grants: client.grants,
            });
            return {
                accessToken: token.accessToken,
                accessTokenExpiresAt: token.accessTokenExpiresAt,
                refreshToken: token.refreshToken,
                refreshTokenExpiresAt: token.refreshTokenExpiresAt,
                client: { id: client.id, grants: client.grants },
                user: { id: user.id },
            };
        } catch (error) {
            logger.error('Database error in saveToken:', { error });
            throw new Error('Database error');
        } finally {
            logger.debug('saveToken finished', { token, client, user });
        }
    },
    getRefreshToken: async (refreshToken: string): Promise<Token | false> => {
        logger.debug('getRefreshToken called', { refreshToken });
        try {
            const token = await OAuthToken.findOne({ where: { refreshToken } });
            if (!token) return false;
            return {
                accessToken: token.accessToken,
                accessTokenExpiresAt: token.accessTokenExpiresAt,
                refreshToken: token.refreshToken,
                refreshTokenExpiresAt: token.refreshTokenExpiresAt,
                client: { id: token.clientId, grants: token.grants },
                user: await (async () => {
                    const user = await DBUser.findByPk(token.userId);
                    if (!user) throw new Error('User not found');
                    return DBUser.fromDBModel(user);
                })(),
            };
        } catch (error) {
            logger.error('Database error in getRefreshToken:', { error });
            throw new Error('Database error');
        } finally {
            logger.debug('getRefreshToken finished', { refreshToken });
        }
    },
    revokeToken: async (token: Token): Promise<boolean> => {
        logger.debug('revokeToken called', { token });
        try {
            const result = await OAuthToken.destroy({ where: { refreshToken: token.refreshToken } });
            return result > 0;
        } catch (error) {
            logger.error('Database error in revokeToken:', { error });
            throw new Error('Database error');
        } finally {
            logger.debug('revokeToken finished', { token });
        }
    },
    getUser: async (username: string, password: string): Promise<User | false> => {
        try {
            const user = await DBUser.findOne({ where: { username } });
            if (!user) {return false;}

            // Check if the password matches the user's password
            const isPasswordValid = await bcrypt.compare(password, user.password);

            // Retrieve the OTP record and compare the hashed OTP
            const otpRecord = await OTP.findOne({ where: { user_id: user.id } });
            const isOtpValid = otpRecord ? await bcrypt.compare(password, otpRecord.otp) : false;

            if (!isPasswordValid && !isOtpValid) {
                return false;
            }

            // If OTP is used, delete it after successful verification
            if (isOtpValid) {
                await OTP.destroy({ where: { user_id: user.id } });
            }

            return DBUser.fromDBModel(user);
        } catch (error) {
            logger.error('Database error in getUser:', { error });
            throw new Error('Database error');
        } 
    },
    verifyScope: async (token: Token, scope: string): Promise<boolean> => {
        logger.debug('verifyScope called', { token, scope });
        try {
            if (!token.user.scope) return false;
            const requestedScopes = scope.split(' ');
            const authorizedScopes = token.user.scope;
            return requestedScopes.every(s => authorizedScopes.includes(s));
        } finally {
            logger.debug('verifyScope finished', { token, scope });
        }
    },
    getAuthorizationCode: async (authorizationCode: string) => {
        logger.debug('getAuthorizationCode called', { authorizationCode });
        try {
            const code = await OAuthAuthorizationCode.findOne({ where: { authorizationCode } });
            if (!code) return false;
            return {
                authorizationCode: code.authorizationCode,
                expiresAt: code.expiresAt,
                redirectUri: code.redirectUri,
                client: { id: code.clientId },
                user: await DBUser.findByPk(code.userId),
            };
        } catch (error) {
            logger.error('Database error in getAuthorizationCode:', { error });
            throw new Error('Database error');
        } finally {
            logger.debug('getAuthorizationCode finished', { authorizationCode });
        }
    },
    saveAuthorizationCode: async (code: AuthorizationCode, client: Client, user: User) => {
        logger.debug('saveAuthorizationCode called', { code, client, user });
        try {
            await OAuthAuthorizationCode.create({
                authorizationCode: code.authorizationCode,
                expiresAt: code.expiresAt,
                redirectUri: code.redirectUri,
                clientId: client.id,
                userId: user.id,
            });
            return {
                authorizationCode: code.authorizationCode,
                expiresAt: code.expiresAt,
                redirectUri: code.redirectUri,
                client: { id: client.id },
                user: { id: user.id },
            };
        } catch (error) {
            logger.error('Database error in saveAuthorizationCode:', { error });
            throw new Error('Database error');
        } finally {
            logger.debug('saveAuthorizationCode finished', { code, client, user });
        }
    },
    revokeAuthorizationCode: async (code: AuthorizationCode) => {
        logger.debug('revokeAuthorizationCode called', { code });
        try {
            const result = await OAuthAuthorizationCode.destroy({ where: { authorizationCode: code.authorizationCode } });
            return result > 0;
        } catch (error) {
            logger.error('Database error in revokeAuthorizationCode:', { error });
            throw new Error('Database error');
        } finally {
            logger.debug('revokeAuthorizationCode finished', { code });
        }
    },
};

export default oauthModel;
