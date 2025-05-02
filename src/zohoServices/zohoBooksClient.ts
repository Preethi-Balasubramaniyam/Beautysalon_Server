import axios from 'axios';
import { Logger } from 'winston';
import { ZohoConfiguration } from '../types/orgTypes';
import Org from '../models/org'; // Adjust the import path as necessary
import fs from 'fs';
import path from 'path';

interface TokenData {
    access_token: string;
    refresh_token: string;
    expiry_time: Date;
}

class ZohoBooksClient {
    private logger: Logger;
    private tokenManager: TokenManager;

    private constructor(logger: Logger, tokenManager: TokenManager) {
        this.logger = logger;
        this.tokenManager = tokenManager;
    }

    private static tokenManagers: Map<string, TokenManager> = new Map();

    public static async getInstance(logger: Logger, orgId: string): Promise<ZohoBooksClient> {
        const currentConfig = await Org.getConfiguration(orgId);
        if (!currentConfig || !currentConfig.zoho) {
            throw new Error('Zoho configuration not found');
        }

        let tokenManager: TokenManager;
        if (this.tokenManagers.has(orgId)) {
            tokenManager = this.tokenManagers.get(orgId)!;
            if (JSON.stringify(currentConfig.zoho) !== JSON.stringify(tokenManager.zohoConfig)) {
                tokenManager = new TokenManager(currentConfig.zoho, logger);
                this.tokenManagers.set(orgId, tokenManager);
            }
        } else {
            tokenManager = new TokenManager(currentConfig.zoho, logger);
            this.tokenManagers.set(orgId, tokenManager);
        }

        return new ZohoBooksClient(logger, tokenManager);
    }

    private async getAccessToken(): Promise<string> {
        return this.tokenManager.getAccessToken(this.logger);
    }

    private async refreshAccessToken(refreshToken: string): Promise<TokenData> {
        return this.tokenManager.refreshAccessToken(refreshToken, this.logger);
    }

    public async getNewRefreshToken(): Promise<string> {
        return this.tokenManager.getNewRefreshToken(this.logger);
    }

    public async getRecords(module: string, params: Record<string, any> = {}): Promise<any> {
        this.logger.info(`Fetching records from ${module}`);
        try {
            const accessToken = await this.getAccessToken();
            params['organization_id'] = this.tokenManager.zohoConfig.orgId;
            const response = await axios.get(`${this.tokenManager.zohoConfig.apiUrl}/${module}`, {
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`
                },
                params: {
                    ...params
                } 
            });
            this.logger.info(`Records fetched from ${module}`);
            return response.data;
        } catch (error) {
            this.logger.error(`Error fetching data from ${module}:`, error);
            throw error;
        }
    }

    public async getRecord(module: string, id: string): Promise<any> {
        this.logger.info(`Fetching recordsfrom ${module} with id ${id}`);
        try {
            const accessToken = await this.getAccessToken();
            const params: Record<string, any> = {};
            params['organization_id'] = this.tokenManager.zohoConfig.orgId;
            const response = await axios.get(`${this.tokenManager.zohoConfig.apiUrl}/${module}/${id}`, {
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`
                },
                params: {
                    ...params
                } 
            });
            this.logger.info(`Record fetched from ${module}`);
            return response.data;
        } catch (error) {
            this.logger.error(`Error fetching data from ${module}:`, error);
            throw error;
        }
    }

    public async getInvoicePdf(id: string): Promise<any> {
        this.logger.info(`Fetching PDF for invoice with id ${id}`);
        try {
            const accessToken = await this.getAccessToken();
            const params: Record<string, any> = {};
            params['organization_id'] = this.tokenManager.zohoConfig.orgId;
            const response = await axios.get(`${this.tokenManager.zohoConfig.apiUrl}/invoices/${id}`, {
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`,
                    'Accept': 'application/pdf'
                },
                params: {
                    ...params
                },
                responseType: 'arraybuffer'
            });
            this.logger.info(`PDF fetched for invoice with id ${id}`);
            return response.data;
        } catch (error) {
            this.logger.error(`Error fetching PDF for invoice with id ${id}:`, error);
            throw error;
        }
    }
        

    public async updateStatus(module: string, id: string, status: string): Promise<any> {
        this.logger.info(`Updating status of record in ${module} with id ${id} to ${status}`);
        try {
            const accessToken = await this.getAccessToken();
            const response = await axios.post(`${this.tokenManager.zohoConfig.apiUrl}/${module}/${id}/status/${status}?organization_id=${this.tokenManager.zohoConfig.orgId}`, {}, {
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`
                }
            });
            this.logger.info(`Status updated in ${module} with id ${id}: %o`, response.data);
            return response.data;
        } catch (error) {
            this.logger.error(`Error updating status in ${module} with id ${id}:`, error);
            throw error;
        }
    }

    public async addRecord(module: string, params: Record<string, any> = {}): Promise<any> {
        this.logger.info(`Adding record to ${module}: %o`, params);
        try {
            const accessToken = await this.getAccessToken();
            params['organization_id'] = this.tokenManager.zohoConfig.orgId;
            const response = await axios.post(`${this.tokenManager.zohoConfig.apiUrl}/${module}?organization_id=${this.tokenManager.zohoConfig.orgId}`, params, {
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`
                }
            });
            this.logger.info(`Record added to ${module}`);
            return response.data;
        } catch (error: any) {
            this.logger.error(`Error adding data to ${module}: %o`, { message: error.message, data: error?.response.data });
            throw error;
        }
    }

    public async updateRecord(module: string, id: string, params: Record<string, any> = {}): Promise<any> {
        this.logger.info(`Updating record in ${module} with id ${id}`);
        try {
            const accessToken = await this.getAccessToken();
            params['organization_id'] = this.tokenManager.zohoConfig.orgId;
            const response = await axios.put(`${this.tokenManager.zohoConfig.apiUrl}/${module}/${id}?organization_id=${this.tokenManager.zohoConfig.orgId}`, params, {
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`
                }
            });
            this.logger.info(`Record updated in ${module} with id ${id}`);
            return response.data;
        } catch (error) {
            this.logger.error(`Error updating data in ${module} with id ${id}:`, error);
            throw error;
        }
    }

    public async deleteRecord(module: string, id: string): Promise<any> {
        this.logger.info(`Deleting record in ${module} with id ${id}`);
        try {
            const accessToken = await this.getAccessToken();
            const response = await axios.delete(`${this.tokenManager.zohoConfig.apiUrl}/${module}/${id}?organization_id=${this.tokenManager.zohoConfig.orgId}`, {
                headers: {
                    'Authorization': `Zoho-oauthtoken ${accessToken}`
                }
            });
            this.logger.info(`Record deleted in ${module} with id ${id}`);
            return response.data;
        } catch (error) {
            this.logger.error(`Error deleting data in ${module} with id ${id}:`, error);
            throw error;
        }
    }
}

class TokenManager {
    public zohoConfig: ZohoConfiguration;
    private tokenData: TokenData | null = null;
    private tokenFilePath: string;

    constructor(config: ZohoConfiguration, logger: Logger) {
        this.zohoConfig = config;
        this.tokenFilePath = path.join(__dirname, `./tokens/${config.orgId}_token.json`);
        this.ensureTokenDirectoryExists(logger);
        this.loadTokenFromFile(logger);
    }

    private ensureTokenDirectoryExists(logger: Logger) {
        const dir = path.dirname(this.tokenFilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            logger.info('Token directory created');
        } else {
            logger.info('Token directory already exists');
        }
    }

    private loadTokenFromFile(logger: Logger) {
        if (fs.existsSync(this.tokenFilePath)) {
            const tokenData = fs.readFileSync(this.tokenFilePath, 'utf8');
            this.tokenData = JSON.parse(tokenData);
            logger.info('Token loaded from file');
        } else {
            this.tokenData = null;
            logger.info('No token file found');
        }
    }

    private saveTokenToFile(logger: Logger) {
        if (this.tokenData) {
            fs.writeFileSync(this.tokenFilePath, JSON.stringify(this.tokenData), 'utf8');
            logger.info('Token saved to file');
        }
    }

    public async getAccessToken(logger: Logger): Promise<string> {
        logger.debug('Getting access token');
        if (this.tokenData && new Date(this.tokenData.expiry_time) > new Date()) {
            logger.debug('Token is valid');
            return this.tokenData.access_token;
        } else {
            logger.info('Token expired or not found, refreshing');
            this.tokenData = await this.refreshAccessToken(this.zohoConfig.refreshToken, logger);
            this.saveTokenToFile(logger);
            return this.tokenData.access_token;
        }
    }

    public async refreshAccessToken(refreshToken: string, logger: Logger): Promise<TokenData> {
        logger.info('Refreshing token');
        try {
            const response = await axios.post<{ access_token: string, expires_in: number }>(`${this.zohoConfig.tokenUrl}`, null, {
                params: {
                    refresh_token: refreshToken,
                    client_id: this.zohoConfig.clientId,
                    client_secret: this.zohoConfig.clientSecret,
                    grant_type: 'refresh_token'
                }
            });

            const newTokenData: TokenData = {
                access_token: response.data.access_token,
                refresh_token: refreshToken,
                expiry_time: new Date(new Date().getTime() + response.data.expires_in * 1000)
            };

            logger.info('Token refreshed');
            return newTokenData;
        } catch (error) {
            logger.error('Error refreshing token:', error);
            throw error;
        }
    }

    public async getNewRefreshToken(logger: Logger): Promise<string> {
        logger.info('Getting new refresh token');
        try {
            const authorizationCode = '1000.e98e9c617c4e28e3d9ef15337d25a876.5cc457add67ba6315dccb6b0b153cdb5';
            const tokenResponse = await axios.post<{ refresh_token: string }>(`${this.zohoConfig.tokenUrl}`, null, {
                params: {
                    code: authorizationCode,
                    client_id: this.zohoConfig.clientId,
                    client_secret: this.zohoConfig.clientSecret,
                    redirect_uri: "",
                    grant_type: 'authorization_code'
                }
            });

            const newRefreshToken = tokenResponse.data.refresh_token;
            logger.info('New refresh token obtained %o', newRefreshToken);
            return newRefreshToken;
        } catch (error) {
            logger.error('Error getting new refresh token:', error);
            throw error;
        }
    }
}

export {
    ZohoBooksClient
};
