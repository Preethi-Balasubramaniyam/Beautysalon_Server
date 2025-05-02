import express from 'express';
import { UserRole, UserScope } from '../types/userTypes';

export const authorize = (requiredScopes: UserScope[]) => {
    return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const username = req.user?.username;

        if (!username) {
            req.logger.warn('User not authenticated');
            res.status(401).json({ error: 'User not authenticated' });
            return;
        }

        const userScopes = req.user.scope || [];
        const hasRequiredScope = requiredScopes.every(scope => userScopes.includes(scope));

        if (req.user.role !== UserRole.Admin) {
            if (!hasRequiredScope) {
                req.logger.warn(`User ${username} does not have required scopes: ${requiredScopes}`);
                res.status(403).json({ error: 'Authorization Failure' });
                return;
            }
            if (!req.user.orgId) {
                req.logger.warn(`User ${username} does not have an organization ID`);
                res.status(400).json({ error: 'Organization ID is required for non-admin users' });
                return;
            }
        }

        next();
    };
};