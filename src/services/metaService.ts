import axios from 'axios';
import logger from '../common/logger';
import config from 'config';

export interface MetaService {
    exchangeForLongLivedToken(shortLivedToken: string): Promise<string>;
    fetchOwnedWhatsAppAccounts(accessToken: string): Promise<{ id: string; name: string }[]>;
    fetchWABANumbers(accountIds: string[], accessToken: string): Promise<Map<string, { phone_numbers: { data: { id: string; display_phone_number: string }[] } }>>;
    fetchWhatsAppTemplates(accountId: string, accessToken: string): Promise<{ name: string; category: string; status: string; language: string }[]>;
    fetchInstagramBusinessAccounts(accessToken: string): Promise<{ id: string; name?: string }[]>;
}

export class MetaServiceImpl implements MetaService {
    private static instance: MetaServiceImpl;
    private readonly appId: string;
    private readonly appSecret: string;

    private constructor(appId: string, appSecret: string) {
        this.appId = appId;
        this.appSecret = appSecret;
    }

    public static getInstance(appId?: string, appSecret?: string): MetaServiceImpl {
        if (!MetaServiceImpl.instance) {
            if (!appId || !appSecret) {
                throw new Error('App ID and App Secret are required for first initialization');
            }
            MetaServiceImpl.instance = new MetaServiceImpl(appId, appSecret);
        }
        return MetaServiceImpl.instance;
    }

    async exchangeForLongLivedToken(shortLivedToken: string): Promise<string> {
        logger.info('Attempting to exchange short-lived token for long-lived token');
        const url = `https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${this.appId}&client_secret=${this.appSecret}&fb_exchange_token=${shortLivedToken}`;
        
        try {
            const response = await axios.get(url);
            if (response.status !== 200) {
                logger.error('Failed to exchange token: Invalid response status', { status: response.status });
                throw new Error('Failed to exchange token');
            }
            logger.info('Successfully exchanged token for long-lived token %o', response?.data ?? response );
            return response.data.access_token;
        } catch (error) {
            logger.error('Error exchanging token: %o', error);
            throw error;
        }
    }

    async fetchOwnedWhatsAppAccounts(accessToken: string): Promise<{ id: string; name: string }[]> {
        logger.info('Fetching owned WhatsApp business accounts');
        const url = `https://graph.facebook.com/v19.0/me/businesses?fields=owned_whatsapp_business_accounts&access_token=${accessToken}`;
        
        try {
            const response = await axios.get(url);
            logger.info('Response: %o', response?.data ?? response);
            if (response.status !== 200) {
                logger.error('Failed to fetch WhatsApp accounts: Invalid response status', { status: response.status });
                throw new Error('Failed to fetch WhatsApp accounts');
            }

            // Extract all WhatsApp business accounts from all businesses
            const accounts: { id: string; name: string }[] = [];
            for (const business of response.data.data) {
                logger.info('Business: %o', business);
                if (business.owned_whatsapp_business_accounts?.data) {
                    logger.info('Owned WhatsApp business accounts: %o', business.owned_whatsapp_business_accounts.data);
                    accounts.push(...business.owned_whatsapp_business_accounts.data);
                }
            }

            logger.info('Successfully fetched WhatsApp business accounts', { count: accounts.length });
            return accounts;
        } catch (error) {
            logger.error('Error fetching WhatsApp business accounts: %o', error);
            throw error;
        }
    }

    async fetchWABANumbers(accountIds: string[], accessToken: string): Promise<Map<string, { phone_numbers: { data: { id: string; display_phone_number: string }[] } }>> {
        if (accountIds.length === 0) {
            logger.info('No account IDs provided, returning empty map');
            return new Map();
        }
        
        logger.info('Fetching WABA numbers for accounts', { accountIds });
        const url = `https://graph.facebook.com/v19.0?ids=${accountIds.join(',')}&fields=phone_numbers&access_token=${accessToken}`;
        
        try {
            const response = await axios.get(url);
            logger.info('Response: %o', response.data);
            if (response.status !== 200) {
                logger.error('Failed to fetch WABA numbers: Invalid response status', { status: response.status });
                throw new Error('Failed to fetch WABA numbers');
            }
            logger.info('Successfully fetched WABA numbers', { accountCount: Object.keys(response.data).length });
            return new Map(Object.entries(response.data));
        } catch (error) {
            logger.error('Error fetching WABA numbers: %o', error);
            throw error;
        }
    }

    async fetchWhatsAppTemplates(accountId: string, accessToken: string): Promise<{ name: string; category: string; status: string; language: string }[]> {
        logger.info('Fetching WhatsApp templates for account', { accountId });
        const url = `https://graph.facebook.com/v19.0/${accountId}/message_templates?access_token=${accessToken}`;
        
        try {
            const response = await axios.get(url);
            logger.info('Response: %o', response.data);
            if (response.status !== 200) {
                logger.error('Failed to fetch WhatsApp templates: Invalid response status', { status: response.status });
                throw new Error('Failed to fetch WhatsApp templates');
            }
            logger.info('Successfully fetched WhatsApp templates', { templateCount: response.data.data.length });
            return response.data.data.map((template: { name: string; category: string; status: string; language: string }) => ({
                name: template.name,
                category: template.category,
                status: template.status,
                language: template.language
            }));
        } catch (error) {
            logger.error('Error fetching WhatsApp templates: %o', error);
            throw error;
        }
    }

    async fetchInstagramBusinessAccounts(accessToken: string): Promise<{ id: string; name?: string }[]> {
        logger.info('Fetching Instagram business accounts');
        const url = `https://graph.facebook.com/v19.0/me/accounts?fields=instagram_business_account&access_token=${accessToken}`;
        
        try {
            const response = await axios.get(url);
            logger.info('Response: %o', response?.data ?? response);
            if (response.status !== 200) {
                logger.error('Failed to fetch Instagram accounts: Invalid response status', { status: response.status });
                throw new Error('Failed to fetch Instagram accounts');
            }

            // Extract Instagram business accounts from Facebook pages
            const accounts: { id: string; name?: string }[] = [];
            if (response.data?.data) {
                for (const page of response.data.data) {
                    if (page.instagram_business_account) {
                        logger.info('Found Instagram business account: %o', page.instagram_business_account);
                        accounts.push({
                            id: page.instagram_business_account.id,
                            name: page.name // Include the page name if available
                        });
                    }
                }
            }

            logger.info('Successfully fetched Instagram business accounts', { count: accounts.length });
            return accounts;
        } catch (error) {
            logger.error('Error fetching Instagram business accounts: %o', error);
            throw error;
        }
    }

    /**
     * Subscribes a webhook URL to receive notifications from a WhatsApp Business Account
     * 
     * @param phoneId The ID of the WhatsApp Business phone number
     * @param authToken Meta API token with permissions to manage the phone number
     * @param webhookUrl The URL that will receive webhook notifications
     * @param verifyToken A token to verify webhook setup
     * @returns A promise that resolves when the subscription is complete
     */
    public static async subscribeWhatsAppWebhook(
        accountId: string,
        authToken: string,
        webhookUrl: string,
        verifyToken: string
    ): Promise<void> {
        try {
            logger.info(`Subscribing to webhooks for WhatsApp account ID: ${accountId} with URL: ${webhookUrl}`);
            
            const response = await axios.post(
                `https://graph.facebook.com/v19.0/${accountId}/subscribed_apps`,
                {
                    subscribed_fields: ['messages', 'message_reactions', 'message_template_status_update'],
                    override_callback_url: webhookUrl,
                    verify_token: verifyToken
                },
                {
                    headers: {
                        'Authorization': `Bearer ${authToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            logger.info(`WhatsApp webhook subscription response: %o`, response.data);
            logger.info(`Successfully subscribed to webhooks for WhatsApp account ID: ${accountId}`);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any  
        } catch (error: any) {
            logger.error(`Error subscribing to webhooks for WhatsApp account ID ${accountId}: %o`, error);
            throw new Error(`Failed to subscribe WhatsApp webhook: ${error.message}`);
        }
    }
    
}

// Initialize and export the singleton instance
export const metaService = MetaServiceImpl.getInstance(
    config.get('meta.appId'),
    config.get('meta.appSecret')
); 