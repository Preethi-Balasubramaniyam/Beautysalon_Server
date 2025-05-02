import { Router, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { body, validationResult, query } from 'express-validator';
import { Channel } from '../types/commTypes';
import logger from '../common/logger';
import EndpointModel from '../models/endpoint';
import { authenticateToken } from '../middleware/authenticateToken';
import { authorize } from '../middleware/authorize';
import { UserScope } from '../types/userTypes';
const router = Router();

const findOrCreateValidation = [
    body('channel').notEmpty().withMessage('Channel is required').isIn(Object.values(Channel)).withMessage('Invalid channel'),
    body('externalId').notEmpty().withMessage('External ID is required').isString().withMessage('External ID must be a string'),
    body('displayName').notEmpty().withMessage('Display name is required').isString().withMessage('Display name must be a string'),
    body('metaData').optional().isObject().withMessage('Meta data must be an object'),
    body('userId').optional().isUUID().withMessage('Invalid user ID'),
];

router.post('/', authenticateToken, authorize([UserScope.ServiceProvider]), findOrCreateValidation, async (req: ExpressRequest, res: ExpressResponse) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        logger.warn('Validation errors', { errors: errors.array() });
        res.status(400).json({ errors: errors.array() });
        return;
    }

    try {
        const { channel, externalId, displayName, metaData, userId } = req.body;

        const endpoint = await EndpointModel.findOrCreateByExternalId(
            req.user.orgId,
            externalId,
            channel,
            displayName,
            metaData,
            userId
        );

        res.status(200).json({endpoint});
    } catch (error) {
        logger.error('Error finding or creating endpoint:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

const findByChannelExternalIdValidation = [
    query('channel').notEmpty().withMessage('Channel is required').isIn(Object.values(Channel)).withMessage('Invalid channel'),
    query('externalId').notEmpty().withMessage('External ID is required').isString().withMessage('External ID must be a string'),
];

router.get('/', authenticateToken, findByChannelExternalIdValidation, async (req: ExpressRequest, res: ExpressResponse) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        logger.warn('Validation errors', { errors: errors.array() });
        res.status(400).json({ errors: errors.array() });
        return;
    }
    
    try {
        const { channel, externalId } = req.query;
        const channelStr = channel as Channel;
        const externalIdStr = externalId as string;
        
        // Find the endpoint
        const endpoint = await EndpointModel.findOne({
            where: {
                orgId: req.user.orgId,
                channel: channelStr,
                externalId: externalIdStr
            }
        });
        
        if (!endpoint) {
            res.status(404).json({ error: 'Endpoint not found' });
            return;
        }
        
        const response = EndpointModel.mapDBModel2Interface(endpoint);
        res.status(200).json({ endpoint: response });
    } catch (error) {
        logger.error('Error finding endpoint:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

const updateValidation = [
    body('displayName').optional().isString().withMessage('Display name must be a string'),
    body('metaData').optional().isObject().withMessage('Meta data must be an object'),
    body('userId').optional().isUUID().withMessage('Invalid user ID'),
];

router.patch('/:id', authenticateToken, authorize([UserScope.ServiceProvider]), updateValidation, async (req: ExpressRequest, res: ExpressResponse) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        logger.warn('Validation errors', { errors: errors.array() });
        res.status(400).json({ errors: errors.array() });
        return;
    }

    try {
        const { id } = req.params;
        const { displayName, metaData, userId } = req.body;

        const endpoint = await EndpointModel.findByPk(id);
        if (!endpoint) {
            res.status(404).json({ error: 'Endpoint not found' });
            return;
        }

        if (endpoint.orgId !== req.user.orgId) {
            res.status(403).json({ error: 'Not authorized to update this endpoint' });
            return;
        }

        const updatedEndpoint = await endpoint.update({
            displayName,
            metaData,
            userId,
            updatedAt: new Date()
        });

        const response = EndpointModel.mapDBModel2Interface(updatedEndpoint);
        res.status(200).json(response);
    } catch (error) {
        logger.error('Error updating endpoint:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.get('/:id', authenticateToken, authorize([UserScope.ReadOnlyUser]), async (req: ExpressRequest, res: ExpressResponse) => {
    const endpointId = req.params.id;
    logger.info('Fetching endpoint by id %o', { endpointId });

    try {
        // Find the endpoint in the database
        const endpoint = await EndpointModel.findOne({
            where: {
                id: endpointId,
                orgId: req.user.orgId
            }
        });

        if (!endpoint) {
            res.status(404).json({ error: 'Endpoint not found' });
            return;
        }

        // Return the endpoint details
        const endpointData = EndpointModel.mapDBModel2Interface(endpoint);
        res.status(200).json({ endpoint: endpointData });
    } catch (error) {
        logger.error('Error fetching endpoint: %o', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router; 