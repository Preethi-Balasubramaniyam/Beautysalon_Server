import express from 'express';
import Message from '../models/message';
import { Status, Channel, MessageType, IMessageInput } from '../types/commTypes';
import { body, validationResult, query } from 'express-validator';
import { authorize } from '../middleware/authorize';
import { UserScope } from '../types/userTypes';
import { Op, OrderItem, WhereOptions } from 'sequelize';
import { Router, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import logger from '../common/logger';
import { MessageValidator } from '../utils/messageValidation';
import Endpoint from '../models/endpoint';
import { MessageServicesManager } from '../services/messaging/messageServiceManager';
import { Sequelize } from 'sequelize';

const router = Router();

// Get messages with optional filters
router.get('/', authorize([UserScope.ReadOnlyUser]), [
    query('channel').optional().isIn(Object.values(Channel)).withMessage('Invalid channel type'),
    query('status').optional().isIn(Object.values(Status)).withMessage('Invalid status'),
    query('type').optional().isIn(Object.values(MessageType)).withMessage('Invalid message type'),
    query('endpointIds').optional().isArray().withMessage('Endpoint IDs must be an array'),
    query('endpointIds.*').optional().isUUID().withMessage('Invalid endpoint ID'),
    query('betweenEndpointIds').optional().isArray().withMessage('Between endpoint IDs must be an array'),
    query('betweenEndpointIds.*').optional().isUUID().withMessage('Invalid between endpoint ID'),
    query('filter').optional().isString().withMessage('Filter must be a string'),
    query('sortBy').optional().isIn(['channel', 'status', 'type', 'timestamp', 'createdAt', 'updatedAt', 'content', 'fromEndpoint.externalId', 'toEndpoint.externalId']).withMessage('Invalid sort field'),
    query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Invalid sort order'),
    query('page').optional().isInt({ min: 1 }).default(1),
    query('pageSize').optional().isInt({ min: 1 }).default(10)
], async (req: ExpressRequest, res: ExpressResponse) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        logger.warn('Validation errors', { errors: errors.array() });
        res.status(400).json({ errors: errors.array() });
        return;
    }

    try {
        const { 
            channel, 
            status, 
            type, 
            endpointIds, 
            betweenEndpointIds,
            filter, 
            sortBy, 
            sortOrder, 
            page = 1, 
            pageSize = 10 
        } = req.query as {
            channel?: Channel;
            status?: Status;
            type?: MessageType;
            endpointIds?: string[];
            betweenEndpointIds?: string[];
            filter?: string;
            sortBy?: string;
            sortOrder?: string;
            page?: number;
            pageSize?: number;
        };

        // Build the base where clause
        let whereClause: WhereOptions = {
            orgId: req.user.orgId
        };

        // Add direct filters
        if (channel) whereClause.channel = channel;
        if (status) whereClause.status = status;
        if (type) whereClause.type = type;

        // Add between endpoint IDs filter
        if (betweenEndpointIds && betweenEndpointIds.length === 2) {
            whereClause = {
                ...whereClause,
                [Op.or]: [
                    {
                        fromId: betweenEndpointIds[0],
                        toId: betweenEndpointIds[1]
                    },
                    {
                        fromId: betweenEndpointIds[1],
                        toId: betweenEndpointIds[0]
                    }
                ]
            };
        } else if (endpointIds && endpointIds.length > 0) {
            whereClause = {
                ...whereClause,
                [Op.or]: [
                    { fromId: { [Op.in]: endpointIds } },
                    { toId: { [Op.in]: endpointIds } }
                ]
            };
        }

        if (filter) {
            // Create a complex where clause that searches in content.text and endpoint external IDs
            const safeFilter = filter.toLowerCase();
            
            whereClause = {
                ...whereClause,
                [Op.or]: [
                    // Search in content.text field using Sequelize's JSON accessor
                    Sequelize.where(
                        Sequelize.fn('LOWER', Sequelize.cast(Sequelize.json('content.text'), 'TEXT')),
                        { [Op.like]: `%${safeFilter}%` }
                    ),
                    // Search in endpoint external IDs using association syntax
                    { '$fromEndpoint.externalId$': Sequelize.where(
                        Sequelize.fn('LOWER', Sequelize.col('fromEndpoint.externalId')),
                        { [Op.like]: `%${safeFilter}%` }
                    )},
                    { '$toEndpoint.externalId$': Sequelize.where(
                        Sequelize.fn('LOWER', Sequelize.col('toEndpoint.externalId')),
                        { [Op.like]: `%${safeFilter}%` }
                    )}
                ]
            };
        }

        const offset = (Number(page) - 1) * Number(pageSize);

        let sortByClause: OrderItem[] = [['timestamp', 'DESC']];
        if (sortBy) {
            switch (sortBy) {
                case 'fromEndpoint.externalId':
                    sortByClause = [[ { model: Endpoint, as: 'fromEndpoint' }, 'externalId' , (sortOrder || 'ASC').toUpperCase()]];
                    break;
                case 'toEndpoint.externalId':
                    sortByClause = [[ { model: Endpoint, as: 'toEndpoint' }, 'externalId' , (sortOrder || 'ASC').toUpperCase()]];
                    break;
                default:
                    sortByClause = [[sortBy, (sortOrder || 'ASC').toUpperCase()]];
                    break;
            }
        }

        const { count, rows: messages } = await Message.findAndCountAll({
            where: whereClause,
            limit: Number(pageSize),
            offset,
            order: sortByClause
        });

        req.logger.info('Messages Count: %o', count);
        const messagesOutput = await Promise.all(messages.map((message) => Message.mapDBModel2Interface(message)));
        
        res.status(200).json({
            total: count,
            page: Number(page),
            pageSize: Number(pageSize),
            messages: messagesOutput
        });
    } catch (error) {
        logger.error('Error fetching messages: %o', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.post('/', authorize([UserScope.ServiceProvider]), async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
        const messageInput: IMessageInput = req.body;
        
        // Validate message input using MessageValidator
        const messageValidator = new MessageValidator(req.user.orgId);
        const validationError = await messageValidator.validateMessage(messageInput);
        if (validationError) {
            res.status(400).json({ errors: validationError.errors });
            return;
        }

        // Check if message already exists
        const existingMessage = await Message.findOne({
            where: {
                fromId: messageInput.fromId,
                toId: messageInput.toId,
                content: messageInput.content,
                timestamp: messageInput.timestamp,
                orgId: req.user.orgId
            }
        });

        if (existingMessage) {
            res.status(409).json({ error: 'Message already exists' });
            return;
        }

        const messageServicesManager = MessageServicesManager.getInstance();
        const messageProcessor = await messageServicesManager.getMessageProcessor(req.user.orgId);
        if (!messageProcessor) {
            res.status(400).json({ error: 'No message processor found for organization' });
            return;
        }

        const processedMessage = await messageProcessor.handleMessage(messageInput, req.user);
        if (!processedMessage) {
            res.status(500).json({ error: 'Failed to process message' });
            return;
        }

        res.status(201).json({message: processedMessage});
    } catch (error) {
        logger.error('Error creating message:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/:id', authorize([UserScope.ServiceProvider]), async (req: express.Request, res: express.Response) => {
    try {
        const message = await Message.findOne({
            where: {
                id: req.params.id,
                orgId: req.user.orgId
            }
        });

        if (!message) {
            res.status(404).json({ error: 'Message not found' });
            return;
        }
        const messageOutput = await Message.mapDBModel2Interface(message);
        res.json({message: messageOutput});
    } catch (error) {
        req.logger.error('Error fetching message:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.patch('/:id/status', authorize([UserScope.ServiceProvider]), [
    body('status').notEmpty().withMessage('Status is required').isIn(Object.values(Status)).withMessage('Invalid status'),
    body('metaData.statusReason').optional().isString().withMessage('Status reason must be a string'),
], async (req: ExpressRequest, res: ExpressResponse) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        logger.warn('Validation errors', { errors: errors.array() });
        res.status(400).json({ errors: errors.array() });
        return;
    }

    try {
        const message = await Message.findOne({
            where: {
                id: req.params.id,
                orgId: req.user.orgId
            }
        });

        if (!message) {
            res.status(404).json({ error: 'Message not found' });
            return;
        }

        const now = new Date();
        const updatedMessage = await message.update({
            status: req.body.status,
            metaData: {
                ...message.metaData,
                statusReason: req.body.metaData?.statusReason
            },
            updatedBy: req.user.username,
            updatedAt: now
        });

        const response = await Message.mapDBModel2Interface(updatedMessage);
        res.json({ message: response });
    } catch (error) {
        logger.error('Error updating message status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete a message
router.delete('/:id', authorize([UserScope.ServiceProvider]), async (req: express.Request, res: express.Response) => {
    try {
        const message = await Message.findOne({
            where: {
                id: req.params.id,
                orgId: req.user.orgId
            }
        });

        if (!message) {
            res.status(404).json({ error: 'Message not found' });
            return;
        }

        // Only allow deletion of messages in queued status
        if (message.status !== Status.queued) {
            res.status(400).json({ error: 'Only messages in queued status can be deleted' });
            return;
        }

        await message.destroy();
        res.status(204).send();
    } catch (error) {
        req.logger.error('Error deleting message:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;