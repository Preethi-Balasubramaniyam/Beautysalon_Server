import Axios, { AxiosInstance } from 'axios';
import { AccessToken, ResourceOwnerPassword,AuthorizationCode } from 'simple-oauth2'; // Add ResourceOwnerPassword


export interface LoginInput {
	username: string;
	password: string;
}

export interface LoginResponse {
	accessToken: string;
	refreshToken: string;
}

export class AuthClient {
	private apiClient: AxiosInstance;
	private token: AccessToken | undefined;
	private baseURL:string;
	
	constructor(stage: string, loginInput?: LoginInput) {
		this.baseURL = 'http://localhost:8080/';
		if (stage === 'prod') {
			this.baseURL = 'https://prod.cleopatraapp.com/';
		} else if (stage === 'staging') {
			this.baseURL = 'https://staging.cleopatraapp.com/';
		}

		this.apiClient = Axios.create({
			baseURL : this.baseURL
		});

	}

	private async getAccessToken(): Promise<string> {
		if (!this.token ) {
			this.performLogin();
		} else if (this.token.expired()) {
			this.refreshToken(this.token.token.refresh_token as string );
		}
		return this.token?.token.accessToken as string;
	}

	public async get(url: string, config?: any): Promise<any> {
		try {
			const accessToken = await this.getAccessToken();
			const headers = { "Authorization": "Bearer " + accessToken, ...config?.headers };
			return this.apiClient.get(url, { ...config, headers });
		} catch (error) {
			console.error('Error during GET request:', error);
			throw error;
		}
	}

	public async post(url: string, data?: any, config?: any): Promise<any> {
		try {
			const accessToken = await this.getAccessToken();
			const headers = { "Authorization": "Bearer " + accessToken,
				"Content-Type": "application/x-www-form-urlencoded",
				 ...config?.headers };
			return this.apiClient.post(url, data, { ...config, headers });
		} catch (error) {
			console.error('Error during POST request:', error);
			throw error;
		}
	}

	public async put(url: string, data?: any, config?: any): Promise<any> {
		try {
			const accessToken = await this.getAccessToken();
			const headers = { "Authorization": "Bearer " + accessToken, ...config?.headers };
			return this.apiClient.put(url, data, { ...config, headers });
		} catch (error) {
			console.error('Error during PUT request:', error);
			throw error;
		}
	}

	public async delete(url: string, config?: any): Promise<any> {
		try {
			const accessToken = await this.getAccessToken();
			const headers = { "Authorization": "Bearer " + accessToken, ...config?.headers };
			return this.apiClient.delete(url, { ...config, headers });
		} catch (error) {
			console.error('Error during DELETE request:', error);
			throw error;
		}
	}

	public async performLogin(input: LoginInput = { username: "rbalagur", password: "UMad3884" }): Promise<LoginResponse> {
		const oauthClient = new ResourceOwnerPassword({
			client: {
				id: 'ScriptClient',
				secret: 'DontTellAnyone',
			},
			auth: {
				tokenHost: this.baseURL,
				tokenPath: 'oauth/token',
				refreshPath: 'oauth/token',
				revokePath: 'oauth/revoke',
			},
			options: {
				authorizationMethod: 'body',
			},
		});
		const tokenParams = {
			username: input.username,
			password: input.password,
			scope: 'your_scope', // Add your scope here if needed
			grant_type: 'password', // Add grant_type parameter
		};
		try {
			const token = await oauthClient.getToken(tokenParams, {
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				json: true,
			});
			
			this.token = token;
			console.log('Login response: %o', this.token.token);
			return { accessToken: token.token.accessToken as string, refreshToken: token.token.refreshToken as string };
		} catch (error) {
			console.error('Error during login:', error);
			throw new Error('Unable to perform login');
		}
	}

	public async refreshToken(refreshToken: string): Promise<LoginResponse> {
		try {
			if (refreshToken) {
				try {
					const oauthClient = new ResourceOwnerPassword({
						client: {
							id: 'TestClient',
							secret: 'DontTellAnyone',
						},
						auth: {
							tokenHost: this.baseURL,
							tokenPath: 'oauth/token',
							refreshPath: 'oauth/token',
							revokePath: 'oauth/revoke',
						},
						options: {
							authorizationMethod: 'body',
						},
					});
					const aToken = oauthClient.createToken({refresh_token: refreshToken});
					const newToken = await aToken.refresh();
					this.token = newToken;
					console.log('Refreshed token: %o', this.token.token.accessToken);
					return { accessToken: newToken.token.access_token as string, refreshToken: newToken.token.refresh_token as string };
				} catch (error) {
					console.error('Error refreshing token:', error);
					throw new Error('Unable to refresh token');
				}
			} else {
				throw new Error('Refresh token is required');
			}
		} catch (error) {
			console.error('Error refreshing token:', error);
			throw new Error('Unable to refresh token');
		}
	}

public async performAuthGrantWithRedirect(code: string, redirectUri: string): Promise<LoginResponse> {
	const tokenParams = {
		grant_type: 'authorization_code',
		code: code,
		redirect_uri: redirectUri,
	};
	const oauthClient = new AuthorizationCode({
		client: {
			id: 'TestClient',
			secret: 'DontTellAnyone',
		},
		auth: {
			tokenHost: this.baseURL,
			authorizePath: 'oauth/authorize',
		},
		options: {
			authorizationMethod: 'body',
		},
	});
	try {
		const token = await oauthClient.getToken(tokenParams, {
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			json: true,
		});
		
		this.token = token;
		console.log('Auth grant with redirect response: %o', this.token.token);
		return { accessToken: token.token.accessToken as string, refreshToken: token.token.refreshToken as string };
	} catch (error) {
		console.error('Error during auth grant with redirect:', error);
		throw new Error('Unable to perform auth grant with redirect');
	}
}
}