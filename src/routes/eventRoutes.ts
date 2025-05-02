import express from 'express';
import { Request, Response } from 'express';
import { ValidationError, UniqueConstraintError, Op } from 'sequelize';
import DBEvent from '../models/event';
import DBCustomer from '../models/customer'; // Import customer model
import DBServiceProvider from '../models/serviceProvider'; // Import service provider model
import DBBranch from '../models/branch'; // Import branch model
import { authorize } from '../middleware/authorize';
import { UserScope } from '../types/userTypes';
import {Event, EventInput, EventType} from '../types/eventTypes'; // Import the CheckInOutEventInterface
import { body, validationResult, query } from 'express-validator'; // Import express-validator
import Message from '../models/message';
import {  Status } from '../types/commTypes';
import { createOrUpdateReminderMessage } from '../services/reminderMessageService';import { normalize } from 'path';
import normalizeParameters from '../middleware/paramNormalization';


const router = express.Router();

const handleErrors = (error: any, req:Request, res: Response) => {
    req.logger.error('Error:', error); // Log the error
    if (error instanceof UniqueConstraintError) {
        res.status(400).json({ error: 'Duplicate entry' });
    } else if (error instanceof ValidationError) {
        res.status(400).json({ error: error.errors.map(e => e.message) });
    } else {
        res.status(500).json({ error: 'An error occurred' });
    }
};

const allowedEventTypes = Object.values(EventType);

// POST handler to insert a new CheckInOutEvent record
router.post(
    '/', normalizeParameters,
    authorize([UserScope.ServiceProvider]),
    [
        body('startTime').isISO8601().withMessage('StartTime must be a valid date'),
        body('endTime').optional().isISO8601().withMessage('EndTime must be a valid date'),
        body('serviceProviderId').optional().isString().withMessage('ServiceProviderId must be a string'),
        body('customerId').optional().isString().withMessage('CustomerId must be a string'),
        body('branchId').optional().isString().withMessage('BranchId must be a string'), // Added branchId validation
        body('eventType').isIn(allowedEventTypes).withMessage('EventType must be one of the allowed values'),
        body('eventDetails').isObject().withMessage('EventDetails must be an object'),
        body('location').isObject().withMessage('Location must be an object'),
        body('location.latitude').isFloat({ min: -90, max: 90 }).withMessage('Latitude must be a valid coordinate'),
        body('location.longitude').isFloat({ min: -180, max: 180 }).withMessage('Longitude must be a valid coordinate'),
        body('eventDetails.reminderOffset').optional().isInt({ min: 0 }) .withMessage('Reminder time must be set in hours before the event'),
    ],
    async (req: Request, res: Response) => {
        req.logger.info('POST /events called');
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.logger.warn('Validation failed:', errors.array());
            res.status(400).json({ errors: errors.array() });
            return;
        }

        try {
            // Validate relations
            const { serviceProviderId, customerId, branchId } = req.body;
            
            if (serviceProviderId) {
                const serviceProvider = await DBServiceProvider.findByPk(serviceProviderId);
                if (!serviceProvider) {
                    res.status(400).json({ error: 'Invalid serviceProviderId' });
                    return;
                }
            }

            if (customerId) {
                req.logger.debug('Checking customer:', { customerId });
                const customer = await DBCustomer.findByPk(customerId);
                if (!customer) {
                    res.status(400).json({ error: 'Invalid customerId' });
                    return;
                }
            }

            if (branchId) {
                const branch = await DBBranch.findByPk(branchId);
                if (!branch) {
                    res.status(400).json({ error: 'Invalid branchId' });
                    return;
                }
            }
            const newEvent = await DBEvent.create(DBEvent.mapInterface2DBModel(req.body as EventInput, req.user));
            // Handle reminder creation
            if (newEvent.customerId && newEvent.eventDetails.reminderOffset) {
                const reminderMessage = await createOrUpdateReminderMessage({
                    eventId: newEvent.id,
                    eventType: newEvent.eventType,
                    customerId: newEvent.customerId,
                    startTime: newEvent.startTime,
                    reminderOffset: newEvent.eventDetails.reminderOffset,
                    user: req.user
                });

                if (reminderMessage) {
                    await newEvent.update({
                        eventDetails: {
                            ...newEvent.eventDetails,
                            reminderMessageId: reminderMessage.id
                        }
                    });
                }
            }

            const event = DBEvent.mapDBModel2Interface(newEvent);
            req.logger.info(`Created new event: ${JSON.stringify(event)}`);


            res.status(201).json({ event: event });
        } catch (error) {
            handleErrors(error, req, res);
        }
    }
);

// GET handler to retrieve all CheckInOutEvent records
router.get('/', authorize([UserScope.ReadOnlyUser]), [
    query('orgId').optional().isString().withMessage('OrgId must be a string'), // Added orgId filter
    query('serviceProviderId').optional().isString().withMessage('ServiceProviderId must be a string'),
    query('customerId').optional().isString().withMessage('CustomerId must be a string'),
    query('branchId').optional().isString().withMessage('BranchId must be a string'),
    query('eventType').optional().isString().withMessage('EventType must be a string'),
    query('startTimeFrom').optional().isISO8601().withMessage('StartTimeFrom must be a valid date'),
    query('startTimeTo').optional().isISO8601().withMessage('StartTimeTo must be a valid date'),
    query('endTimeFrom').optional().isISO8601().withMessage('EndTimeFrom must be a valid date'),
    query('endTimeTo').optional().isISO8601().withMessage('EndTimeTo must be a valid date'),
    query('sortBy').optional().isIn(['startTime', 'endTime', 'eventType', 'createdAt']).withMessage('Invalid sort field'),
    query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Invalid sort order'),
    query('filter').optional().isString().withMessage('Filter must be a string'),
    query('page').optional().isInt({ min: 1 }).default(1),
    query('pageSize').optional().isInt({ min: 1 }).default(10)
], async (req: Request, res: Response) => {
    req.logger.info('GET /events called'); // Log the route call
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        req.logger.warn('Validation errors:', errors.array()); // Log validation errors
        res.status(400).json({ errors: errors.array() });
        return;
    }
    const { serviceProviderId, customerId, branchId, eventType, startTimeFrom, startTimeTo, endTimeFrom, endTimeTo, sortBy, sortOrder, filter, page = '1', pageSize = '10' } = req.query as {
        orgId?: string;
        serviceProviderId?: string;
        customerId?: string;
        branchId?: string;
        eventType?: string;
        startTimeFrom?: string;
        startTimeTo?: string;
        endTimeFrom?: string;
        endTimeTo?: string;
        sortBy?: 'startTime' | 'endTime' | 'eventType' | 'createdAt';
        sortOrder?: 'asc' | 'desc';
        filter?: string;
        page?: string;
        pageSize?: string;
    };
    try {
        const whereClause: any = { orgId: req.user.orgId }; // Filter by orgId from req.user.orgId
        if (serviceProviderId) whereClause.serviceProviderId = serviceProviderId;
        if (customerId) whereClause.customerId = customerId;
        if (branchId) whereClause.branchId = branchId; // Added branchId filter
        if (eventType) whereClause.eventType = eventType;
        if (startTimeFrom || startTimeTo) {
            whereClause.startTime = {};
            if (startTimeFrom) whereClause.startTime[Op.gte] = new Date(startTimeFrom as string);
            if (startTimeTo) whereClause.startTime[Op.lte] = new Date(startTimeTo as string);
        }
        if (endTimeFrom || endTimeTo) {
            whereClause.endTime = {};
            if (endTimeFrom) whereClause.endTime[Op.gte] = new Date(endTimeFrom as string);
            if (endTimeTo) whereClause.endTime[Op.lte] = new Date(endTimeTo as string);
        }
        if (filter) {
            whereClause[Op.or] = [
                { eventType: { [Op.like]: `%${filter}%` } },
                { '$serviceProvider.name$': { [Op.like]: `%${filter}%` } },
                { '$customer.name$': { [Op.like]: `%${filter}%` } },
                { '$branch.name$': { [Op.like]: `%${filter}%` } }
            ];
        }

        const pageNumber = parseInt(page as string);
        const size = parseInt(pageSize as string);
        const offset = (pageNumber - 1) * size;

        const { count, rows: dbEvents } = await DBEvent.findAndCountAll({
            where: whereClause,
            limit: size,
            offset: offset,
            order: sortBy ? [[sortBy, sortOrder?.toUpperCase() || 'ASC']] : [['createdAt', 'DESC']],
            include: [
                { model: DBServiceProvider, as: 'serviceProvider' },
                { model: DBCustomer, as: 'customer' },
                { model: DBBranch, as: 'branch' }
            ]
        });

        const events = dbEvents.map(event => DBEvent.mapDBModel2Interface(event));
        req.logger.info('Retrieved all events');

        res.status(200).json({
            totalItems: count,
            totalPages: Math.ceil(count / size),
            currentPage: pageNumber,
            pageSize: size,
            events: events
        });
    } catch (error) {
        handleErrors(error, req, res);
    }
});

// GET handler to retrieve a single CheckInOutEvent record by ID
router.get('/:id', authorize([UserScope.ReadOnlyUser]), async (req: Request, res: Response) => {
    const { id } = req.params;
    req.logger.info(`GET /events/${id} called`); // Log the route call
    try {
        const dbEvent = await DBEvent.findByPk(id);
        if (dbEvent) {
            const event = DBEvent.mapDBModel2Interface(dbEvent);
            req.logger.info(`Retrieved event with ID: ${id}`);
            res.status(200).json({ event: event });
        } else {
            res.status(404).json({ error: 'Event not found' });
        }
    } catch (error) {
        handleErrors(error, req, res);
    }
});

// PUT handler to update a CheckInOutEvent record by ID
router.put(
    '/:id',
    normalizeParameters,
    authorize([UserScope.Manager]),
    [
        body('startTime').optional().isISO8601().withMessage('StartTime must be a valid date'),
        body('endTime').optional().isISO8601().withMessage('EndTime must be a valid date'),
        body('serviceProviderId').optional().isString().withMessage('ServiceProviderId must be a string'),
        body('customerId').optional().isString().withMessage('CustomerId must be a string'),
        body('branchId').optional().isString().withMessage('BranchId must be a string'), // Added branchId validation
        body('eventType').optional().isIn(allowedEventTypes).withMessage('EventType must be one of the allowed values'),
        body('eventDetails').optional().isObject().withMessage('EventDetails must be an object'),
        body('location').optional().isObject().withMessage('Location must be an object'),
        body('location.latitude').optional().isFloat({ min: -90, max: 90 }).withMessage('Latitude must be a valid coordinate'),
        body('location.longitude').optional().isFloat({ min: -180, max: 180 }).withMessage('Longitude must be a valid coordinate'),
        body('description').optional().isString().withMessage('Description must be a string'),// Add description validation
        body('eventDetails.reminderOffset').optional().isInt({ min: 0 }) .withMessage('Reminder time must be set in hours before the event'),
    ],
    async (req: Request, res: Response) => {
        const { id } = req.params;
        req.logger.info(`PUT /events/${id} called`); // Log the route call
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.logger.warn('Validation errors:', errors.array()); // Log validation errors
            res.status(400).json({ errors: errors.array() });
            return;
        }
        try {
            const { serviceProviderId, customerId, branchId, startTime, endTime, eventType, eventDetails, location } : EventInput = req.body; // Use EventInput type
            if (serviceProviderId) {
                const serviceProvider = await DBServiceProvider.findByPk(serviceProviderId);
                if (!serviceProvider) {
                    res.status(400).json({ error: 'Invalid serviceProviderId' });
                    return;
                }
            }
            if (customerId) {
                const customer = await DBCustomer.findByPk(customerId);
                if (!customer) {
                    res.status(400).json({ error: 'Invalid customerId' });
                    return;
                }
            }
            if (branchId) {
                const branch = await DBBranch.findByPk(branchId);
                if (!branch) {
                    res.status(400).json({ error: 'Invalid branchId' });
                    return;
                }
            }
            const dbEvent = await DBEvent.findByPk(id);
            if (dbEvent) {
                const originalStartTime = dbEvent.startTime;
                
                // Update event fields
                if (startTime !== undefined) dbEvent.startTime = new Date(startTime);
                if (endTime !== undefined) dbEvent.endTime = new Date(endTime);
                if (eventType !== undefined) dbEvent.eventType = eventType as EventType;
                if (eventDetails !== undefined) dbEvent.eventDetails = eventDetails;
                if (location !== undefined) dbEvent.location = location;
                if (branchId !== undefined) dbEvent.branchId = branchId; 
                if (serviceProviderId !== undefined) dbEvent.serviceProviderId = serviceProviderId;
                dbEvent.updatedBy = req.user.username;  

                // Only handle reminder message if start time actually changed
                if (startTime && originalStartTime.getTime() !== new Date(startTime).getTime()) {
                    const reminderMessageId = dbEvent.eventDetails?.reminderMessageId;
                    const reminderOffset = dbEvent.eventDetails?.reminderOffset;
                
                    if (reminderOffset && dbEvent.customerId) {
                        let shouldCreateNew = true;
                        
                        // Check existing message if we have one
                        if (reminderMessageId) {
                            const existingMessage = await Message.findByPk(reminderMessageId);
                            if (existingMessage && existingMessage.status === Status.queued) {
                                shouldCreateNew = false;
                                const updatedMessage = await createOrUpdateReminderMessage({
                                    eventId: dbEvent.id,
                                    eventType: dbEvent.eventType,
                                    customerId: dbEvent.customerId,
                                    startTime: new Date(startTime),
                                    reminderOffset,
                                    user: req.user,
                                    existingMessageId: reminderMessageId
                                });
                        
                                if (updatedMessage) {
                                    dbEvent.eventDetails = {
                                        ...dbEvent.eventDetails,
                                        reminderMessageId: updatedMessage.id
                                    };
                                }
                            } else {
                                req.logger.info(`Creating new reminder as existing message ${reminderMessageId} is in ${existingMessage?.status} status`);
                            }
                        }

                         if (shouldCreateNew) {
                            const newMessage = await createOrUpdateReminderMessage({
                                eventId: dbEvent.id,
                                eventType: dbEvent.eventType,
                                customerId: dbEvent.customerId,
                                startTime: new Date(startTime),
                                reminderOffset,
                                user: req.user
                            });

                            if (newMessage) {
                                dbEvent.eventDetails = {
                                    ...dbEvent.eventDetails,
                                    reminderMessageId: newMessage.id
                                };
                                req.logger.info(`Updated event with new reminder message ID: ${newMessage.id}`);
                            } else {
                                req.logger.error('Failed to create new reminder message');
                            }
                        }
                    }
                } else {
                    req.logger.debug('Start time unchanged, skipping reminder message update');
                }

                await dbEvent.save();
                const event = DBEvent.mapDBModel2Interface(dbEvent);
                req.logger.info(`Updated event with ID: ${id}`);
                res.status(200).json({ event: event });
            } else {
                res.status(404).json({ error: 'Event not found' });
            }
        } catch (error) {
            handleErrors(error, req, res);
        }
    }
);
// DELETE handler to delete a CheckInOutEvent record by ID
router.delete('/:id', authorize([UserScope.Admin]), async (req: Request, res: Response) => {
    const { id } = req.params;
    req.logger.info(`DELETE /events/${id} called`);
    try {
        const event = await DBEvent.findByPk(id);
        if (event) {
            if (event.eventDetails.reminderMessageId) {
                const message = await Message.findByPk(event.eventDetails.reminderMessageId);
                if (message) {
                    if (message.status === Status.queued) {
                        await message.destroy();
                        req.logger.info(`Deleted associated reminder message ${event.eventDetails.reminderMessageId} for event ${id}`);
                    } else {
                        req.logger.warn(`Associated message ${event.eventDetails.reminderMessageId} not deleted as it's not in queued status`);
                    }
                }
            }

            await event.destroy();
            req.logger.info(`Deleted event with ID: ${id}`);
            res.status(204).send();
        } else {
            res.status(404).json({ error: 'Event not found' });
        }
    } catch (error) {
        handleErrors(error, req, res);
    }
});

export default router;
