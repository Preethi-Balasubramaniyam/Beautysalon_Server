import express from 'express';
import oauth from '../oauthServer';
import { Request, Response } from 'oauth2-server';
import { User } from '../types/userTypes';

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
                user: User;
        }
    }
}

export async function authenticateToken(req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> {
    const request = new Request(req);
    const response = new Response(res);
    
    try {
        const token = await oauth.authenticate(request, response);
        req.user = {
            username: token.user.username,
            role: token.user.role,
            orgId: token.user.orgId,
            scope: token.user.scope,
            id: token.user.id,
            email: token.user.email,
            mobile: token.user.mobile,
            name: token.user.name,
        };
        next();
    } catch (error) {
        req.logger.error('Token is not valid', { error });
        res.status(403).json({ error: 'Token is not valid' });
    }
}

export default authenticateToken;
