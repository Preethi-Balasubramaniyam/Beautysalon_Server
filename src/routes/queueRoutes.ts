import express from 'express';
import { UniqueConstraintError, ValidationError } from 'sequelize';
import DBQueue from '../models/queue'; // Import the queue model
import { Queue, Module } from '../types/queueTypes'; // Import Queue type and Module enum
import { authorize } from '../middleware/authorize';
import { UserScope } from '../types/userTypes';
import { body, validationResult } from 'express-validator';
import { ZohoQueueProcessor } from '../zohoServices/zohoQueueProcessor';

const router = express.Router();

router.get('/:id', authorize([UserScope.ReadOnlyUser]), async (req: express.Request, res: express.Response) => {
    req.logger.info('Fetching queue with ID:', req.params.id);
    try {
        const { id } = req.params;
        const queue = await DBQueue.findOne({
            where: {
                id: id,
                orgId: req.user.orgId // Ensure the queue belongs to the user's orgId
            }
        });
        if (queue) {
            const queueOutput: Queue = DBQueue.mapDBModel2Interface(queue);
            res.status(200).json({queue: queueOutput});
        } else {
            res.status(404).json({ error: 'Queue not found' });
        }
    } catch (error) {
        req.logger.error('Error retrieving data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.put('/:id', authorize([UserScope.ServiceProvider]), [
    body('status').optional().isString().withMessage('Status must be a string'),
    body('processCount').optional().isInt({ min: 0 }).withMessage('Process count must be a non-negative integer'),
    body('metaData').optional().isObject().withMessage('MetaData must be an object') // Add validation for metaData
], async (req: express.Request, res: express.Response) => {
    req.logger.info('Updating queue with ID:', req.params.id, 'with data:', req.body);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        req.logger.warn('Validation errors', { errors: errors.array() });
        res.status(400).json({ errors: errors.array() });
        return;
    }

    const { status, processCount, metaData }: { status?: string; processCount?: number; metaData?: object } = req.body;
    try {
        const { id } = req.params;

        const updateFields: any = {};
        if (status !== undefined) updateFields.status = status;
        if (processCount !== undefined) updateFields.processCount = processCount;
        if (metaData !== undefined) updateFields.metaData = metaData; // Add metaData to updateFields
        const queue: DBQueue | null = await DBQueue.findByPk(id);
        if (queue) {
            await queue.update(updateFields);
            const queueOutput: Queue = DBQueue.mapDBModel2Interface(queue);
            res.status(200).json({ queue: queueOutput });
        } else {
            res.status(404).json({ error: 'Queue not found' });
        }
    } catch (error) {
        req.logger.error('Error updating data:', error);
        if (error instanceof UniqueConstraintError) {
            req.logger.warn('Unique key violation. Duplicate entry detected:', error);
            res.status(409).json({ error: 'Unique key violation. Duplicate entry detected.' });
        } else if (error instanceof ValidationError) {
            req.logger.warn('Invalid data. Please check your input:', error);
            res.status(400).json({ error: 'Invalid data. Please check your input.' });
        } else {
            req.logger.error('Error updating data:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
});

router.post(
    '/',
    authorize([UserScope.ServiceProvider]),
    [
        body('entityId').notEmpty().isString().withMessage('Entity ID is required and must be a string'),
        body('module').notEmpty().isString().withMessage('Module is required and must be a string')
            .isIn(Object.values(Module)).withMessage(`Module must be one of ${Object.values(Module).join(', ')}`),
        body('action').notEmpty().isString().withMessage('Action is required and must be a string')
            .isIn(['createOrUpdate', 'delete']).withMessage('Action must be either createOrUpdate or delete')
    ],
    async (req: express.Request, res: express.Response) => {
        req.logger.info('Creating new queue entry with data:', req.body);
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.logger.warn('Validation errors', { errors: errors.array() });
            res.status(400).json({ errors: errors.array() });
            return;
        }
        try {
            const queue: Queue = req.body;
            const processor = new ZohoQueueProcessor(req.user.orgId, req.logger);
            const queueOutput = await processor.processQueueItem(queue);
            req.logger.info('Queue Processed Successfully:', queueOutput);
            res.status(201).json({queue: queueOutput});
        } catch (error) {
            req.logger.error('Error processing queue entry:', error);
            res.status(500).json({ error: `Internal Server Error - ${error}` });
        }
    }
);

export default router;
