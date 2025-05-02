import { Router, Request, Response } from 'express';
import { check, validationResult } from 'express-validator';
import Org from '../models/org'; // Update import path
import { authorize } from '../middleware/authorize'; // Assuming authorize middleware is in middleware/authorize
import { UserScope } from '../types/userTypes'; // Assuming UserScope is in types/userTypes
import { metaService } from '../services/metaService';
import User from '../models/user';
import { MessageServicesManager } from '../services/messaging/messageServiceManager';
import { UniqueConstraintError } from 'sequelize';
import config from 'config';
import { AddressInfo } from 'net';
import { Server as HttpServer } from 'http';
import socketServer from '../services/socketServer';

const router = Router();

router.post(
  '/',
  authorize([UserScope.Admin]),
  [
    check('name').notEmpty().withMessage('Name is required'),
    check('name').isString().withMessage('Name must be a string'),
    check('name').trim().isLength({ min: 1, max: 100 }).withMessage('Name must be between 1 and 100 characters'),
    check('configuration').notEmpty().withMessage('Configuration is required'),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const orgData = Org.toDBCreate({
        ...req.body,
        // id will be automatically generated as UUID
      }, req.user.username);

      const org = await Org.create(orgData);
      req.logger.info(`Organization created: ${org.id}`);
      res.status(201).json({org: Org.fromDBModel(org)});
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        res.status(409).json({ error: 'Organization name already exists' });
        return;
      }
      req.logger.error(`Error creating organization: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  }
);

router.get(
  '/',
  authorize([UserScope.ReadOnlyUser]),
  async (req: Request, res: Response) => {
    try {
      const orgId = req.user.orgId;
      const org = await Org.findByPk(orgId);
      if (org) {
        res.status(200).json({org: Org.fromDBModel(org)});
      } else {
        res.status(404).json({ error: 'Org not found' });
      }
    } catch (error) {
      req.logger.error(`Error fetching organization: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  }
);

router.put(
  '/',
  authorize([UserScope.Admin]),
  [
    check('name').optional().isString().withMessage('Name must be a string'),
    check('name').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Name must be between 1 and 100 characters'),
    check('configuration').notEmpty().withMessage('Configuration is required'),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const orgId = req.user.orgId;
      const [updated] = await Org.update(
        {
          ...req.body,
          updatedBy: req.user.username,
        },
        {
          where: { id: orgId },
        }
      );
      if (updated) {
        const updatedOrg = await Org.findByPk(orgId);
        req.logger.info(`Organization updated: ${orgId}`);

        // Refresh WhatsApp service with new configuration
        try {
          await MessageServicesManager.getInstance().refreshOrgServices(orgId);
          req.logger.info(`Successfully refreshed messaging services for orgId: ${orgId}`);
        } catch (error) {
          req.logger.error(`Error refreshing messaging services: ${(error as Error).message}`);
          // Continue with the response even if refresh fails
        }

        res.status(200).json({org: Org.fromDBModel(updatedOrg!)});
      } else {
        res.status(404).json({ error: 'Org not found' });
      }
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        res.status(409).json({ error: 'Organization name already exists' });
        return;
      }
      req.logger.error(`Error updating organization: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  }
);

router.delete(
  '/',
  authorize([UserScope.Admin]),
  async (req: Request, res: Response) => {
    try {
      const orgId = req.user.orgId;
      
      await User.destroy({
        where: { orgId },
      });

      
      const deleted = await Org.destroy({
        where: { id: orgId },
      });
      if (deleted) {
        req.logger.info(`Organization deleted: ${orgId}`);
        res.status(204).json();
      } else {
        res.status(404).json({ error: 'Org not found' });
      }
    } catch (error) {
      req.logger.error(`Error deleting organization: ${(error as Error).message}`);
      res.status(500).json({ error: (error as Error).message });
    }
  }
);

router.post(
    '/whatsapp',
    authorize([UserScope.Admin]),
    [
        check('tempToken').notEmpty().withMessage('Temporary token is required'),
    ],
    async (req: Request, res: Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }

        try {
            const { tempToken } = req.body;
            const orgId = req.user.orgId;

            // Exchange temp token for long-lived token
            const longLivedToken = await metaService.exchangeForLongLivedToken(tempToken);

            req.logger.info('Long-lived token: %o', longLivedToken);

            // Fetch owned WhatsApp accounts
            const accounts = await metaService.fetchOwnedWhatsAppAccounts(longLivedToken);
            if (!accounts || !Array.isArray(accounts)) {
                throw new Error('Failed to fetch WhatsApp accounts or invalid response format');
            }
            const accountIds = accounts.map(account => account.id);

            // Fetch phone numbers for each account
            const phoneNumbersData = await metaService.fetchWABANumbers(accountIds, longLivedToken);

            // Create WhatsApp configuration
            const phoneConfig = [];
            for (const [accountId, data] of phoneNumbersData.entries()) {
                const phoneNumbers = data.phone_numbers?.data || [];
                for (const phoneNumber of phoneNumbers) {
                    phoneConfig.push({
                        authToken: longLivedToken,
                        phoneId: phoneNumber.id,
                        phoneNumber: phoneNumber.display_phone_number,
                        accountId: accountId
                    });
                }
            }

            // Fetch templates for each account
            const templates = [];
            for (const accountId of accountIds) {
                const accountTemplates = await metaService.fetchWhatsAppTemplates(accountId, longLivedToken);
                templates.push(...accountTemplates);
            }

            // Update organization configuration
            const org = await Org.findByPk(orgId);
            if (!org) {
                res.status(404).json({ error: 'Organization not found' });
                return;
            }

            const updatedConfiguration = {
                ...org.configuration,
                whatsapp: {
                    chatEndpoints: org.configuration.whatsapp?.chatEndpoints || [],
                    phoneconfig: phoneConfig,
                    templates: templates
                }
            };

            try {
                const [updated] = await Org.update(
                    {
                        configuration: updatedConfiguration,
                        updatedBy: req.user.username
                    },
                    {
                        where: { id: orgId }
                    }
                );

                if (updated === 0) {
                    req.logger.error(`Failed to update organization configuration for orgId: ${orgId}`);
                    res.status(500).json({ error: 'Failed to update organization configuration' });
                    return;
                }

                // Fetch the updated org to return
                const updatedOrg = await Org.findByPk(orgId);
                if (!updatedOrg) {
                    req.logger.error(`Failed to fetch updated organization for orgId: ${orgId}`);
                    res.status(500).json({ error: 'Failed to fetch updated organization' });
                    return;
                }

                req.logger.info(`Successfully updated organization configuration for orgId: ${orgId}`);

                // Refresh WhatsApp service with new configuration
                try {
                    await MessageServicesManager.getInstance().refreshOrgServices(orgId);
                    req.logger.info(`Successfully refreshed messaging services for orgId: ${orgId}`);
                } catch (error) {
                    req.logger.error(`Error refreshing messaging services: ${(error as Error).message}`);
                    // Continue with the response even if refresh fails
                }

                res.status(200).json({ org: Org.fromDBModel(updatedOrg) });
            } catch (error) {
                req.logger.error(`Error updating organization configuration: ${(error as Error).message}`);
                res.status(500).json({ error: (error as Error).message });
            }
        } catch (error) {
            req.logger.error(`Error configuring WhatsApp: ${(error as Error).message}`);
            res.status(500).json({ error: (error as Error).message });
        }
    }
);

router.post(
    '/instagram',
    authorize([UserScope.Admin]),
    [
        check('tempToken').notEmpty().withMessage('Temporary token is required'),
    ],
    async (req: Request, res: Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }

        try {
            const { tempToken } = req.body;
            const orgId = req.user.orgId;

            // Exchange temp token for long-lived token
            const longLivedToken = await metaService.exchangeForLongLivedToken(tempToken);

            req.logger.info('Instagram long-lived token obtained');

            // Fetch Instagram business accounts
            const businessAccounts = await metaService.fetchInstagramBusinessAccounts(longLivedToken);
            
            if (!businessAccounts || businessAccounts.length === 0) {
                req.logger.error('No Instagram business accounts found');
                res.status(404).json({ error: 'No Instagram business accounts found. Please link a business account to your Facebook page.' });
                return;
            }

            // Use the first business account (most common case)
            const instagramBusinessAccountId = businessAccounts[0].id;
            req.logger.info(`Instagram business account found: ${instagramBusinessAccountId}`);

            // Update organization configuration
            const org = await Org.findByPk(orgId);
            if (!org) {
                res.status(404).json({ error: 'Organization not found' });
                return;
            }

            const updatedConfiguration = {
                ...org.configuration,
                instagram: {
                    businessAccountId: instagramBusinessAccountId,
                    authToken: longLivedToken
                }
            };

            try {
                const [updated] = await Org.update(
                    {
                        configuration: updatedConfiguration,
                        updatedBy: req.user.username
                    },
                    {
                        where: { id: orgId }
                    }
                );

                if (updated === 0) {
                    req.logger.error(`Failed to update organization configuration for orgId: ${orgId}`);
                    res.status(500).json({ error: 'Failed to update organization configuration' });
                    return;
                }

                // Fetch the updated org to return
                const updatedOrg = await Org.findByPk(orgId);
                if (!updatedOrg) {
                    req.logger.error(`Failed to fetch updated organization for orgId: ${orgId}`);
                    res.status(500).json({ error: 'Failed to fetch updated organization' });
                    return;
                }

                req.logger.info(`Successfully updated organization configuration with Instagram for orgId: ${orgId}`);

                // Refresh services if needed (similar to WhatsApp)
                try {
                    await MessageServicesManager.getInstance().refreshOrgServices(orgId);
                    req.logger.info(`Successfully refreshed messaging services for orgId: ${orgId}`);
                } catch (error) {
                    req.logger.error(`Error refreshing messaging services: ${(error as Error).message}`);
                    // Continue with the response even if refresh fails
                }

                res.status(200).json({ org: Org.fromDBModel(updatedOrg) });
            } catch (error) {
                req.logger.error(`Error updating organization configuration: ${(error as Error).message}`);
                res.status(500).json({ error: (error as Error).message });
            }
        } catch (error) {
            req.logger.error(`Error configuring Instagram: ${(error as Error).message}`);
            res.status(500).json({ error: (error as Error).message });
        }
    }
);

// Get organization socket namespace URL
router.get('/socketUrl', authorize([UserScope.ReadOnlyUser]), async (req: Request, res: Response): Promise<void> => {
    try {
        const orgId = req.user.orgId;
        if (!orgId) {
            res.status(400).json({ error: 'Organization ID not found' });
            return;
        }

        const httpServer = socketServer.getIO().httpServer as HttpServer;
        const address = httpServer.address() as AddressInfo;
        const serverUrl = config.get('server.socketUrl') || `http://localhost:${address.port}`;
        const orgNamespaceUrl = `${serverUrl}/${orgId}`;

        res.json({ url: orgNamespaceUrl });
    } catch (error) {
        req.logger.error('Error getting socket URL:', error);
        res.status(500).json({ error: 'Failed to get socket URL' });
    }
});

export default router;
