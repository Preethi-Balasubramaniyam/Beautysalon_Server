import OAuth2Server from 'oauth2-server';
import oauthModel from './models/oauthModel';

const oauth = new OAuth2Server({
    model: oauthModel,
    accessTokenLifetime: 3600,
    refreshTokenLifetime: 1209600,                                 
});

export const Request = OAuth2Server.Request;
export const Response = OAuth2Server.Response;

export default oauth;