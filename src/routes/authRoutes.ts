import express from 'express';
import { body, validationResult } from 'express-validator';
import oauth from '../oauthServer'; // Use oauth from oauthServer.ts
import { Request as OAuthRequest, Response as OAuthResponse } from 'oauth2-server';

const router = express.Router();

router.post('/token', [
    body('username').optional().notEmpty().withMessage('Username is required'),
    body('password').optional().notEmpty().withMessage('Password is required'),
    body('refresh_token').optional().notEmpty().withMessage('Refresh token is required'),
], (req: express.Request, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }

    const request = new OAuthRequest(req);
    const response = new OAuthResponse(res);

    oauth.token(request, response)
        .then((token) => {
            const expiresIn = token.accessTokenExpiresAt ? Math.floor((token.accessTokenExpiresAt.getTime() - Date.now()) / 1000) : null;
            res.status(200).json({
                ...token,
                access_token: token.accessToken,
                refresh_token: token.refreshToken,
                expires_in: expiresIn,
                token_type: 'Bearer',
                scope: token.scope,
            });
        })
        .catch((err) => {
            res.status(err.code || 500).json(err);
        });
});

router.post('/authorize', [
    body('client_id').notEmpty().withMessage('Client ID is required'),
    body('redirect_uri').notEmpty().withMessage('Redirect URI is required'),
    body('response_type').notEmpty().withMessage('Response type is required'),
    body('scope').notEmpty().withMessage('Scope is required')
], (req: express.Request, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
    }

    const request = new OAuthRequest(req);
    const response = new OAuthResponse(res);

    oauth.authorize(request, response)
        .then((authorizationCode) => {
            res.status(201).json(authorizationCode);
        })
        .catch((err) => {
            res.status(err.code || 500).json(err);
        });
});

router.get('/user', (req: express.Request, res: express.Response) => {
    const request = new OAuthRequest(req);
    const response = new OAuthResponse(res);

    oauth.authenticate(request, response)
        .then((token) => {
            res.status(200).json({user:token.user});
        })
        .catch((err) => {
            res.status(err.code || 500).json(err);
        });
});

export default router;
