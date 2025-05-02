import { Router, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { body, validationResult, query } from 'express-validator';
import CallRecord from '../models/callRecord';
import { CallType } from '../types/commTypes';
import logger from '../common/logger';
import { Channel } from '../types/commTypes';
import { Op, WhereOptions } from 'sequelize';
import { authenticateToken } from '../middleware/authenticateToken';
import Org from '../models/org';
import { authorize } from '../middleware/authorize';
import { UserScope } from '../types/userTypes';
import { ExotelService, ExotelServiceImpl } from '../services/exotelService';
import EndpointModel from '../models/endpoint';

const router = Router();
const exotelService: ExotelService = new ExotelServiceImpl();

const callValidation = [
    body('fromId').optional().isUUID().withMessage('Invalid from endpoint ID'),
    body('toId').notEmpty().withMessage('To endpoint ID is required').isUUID().withMessage('Invalid to endpoint ID'),
    body('initiatorId').notEmpty().withMessage('Initiator endpoint ID is required').isUUID().withMessage('Invalid initiator endpoint ID'),
];

const endpointValidation = [
    query('endpointId').optional().isUUID().withMessage('Invalid endpoint ID'),
    query('externalId').optional().isString().withMessage('External ID must be a string'),
];

router.post('/', authenticateToken, authorize([UserScope.ServiceProvider]), callValidation, async (req: ExpressRequest, res: ExpressResponse) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        logger.warn('Validation errors', { errors: errors.array() });
        res.status(400).json({ errors: errors.array() });
        return;
    }

    const { fromId, toId, initiatorId } = req.body;
    const orgConfig = await Org.getConfiguration(req.user.orgId);

    if (!orgConfig || !orgConfig.exotel) {
        res.status(404).json({ error: `Calling not supported for this org ${req.user.orgId}` });
        return;
    }

    try {
        // Fetch endpoints
        const fromEndpoint = await EndpointModel.findByPk(fromId);
        let finalFromEndPointId = fromEndpoint ? fromEndpoint.id : null;
        let finalFromEndPointExternalId = fromEndpoint ? fromEndpoint.externalId : null;
        const toEndpoint = await EndpointModel.findByPk(toId);
        const initiatorEndpoint = await EndpointModel.findByPk(initiatorId);

        if (!finalFromEndPointId || !finalFromEndPointExternalId) {
            const anyOrgFromEndpoint = await exotelService.getFromEndpoint(req.user.orgId, orgConfig.exotel);
            finalFromEndPointId = anyOrgFromEndpoint.id;
            finalFromEndPointExternalId = anyOrgFromEndpoint.externalId;
        }

        if (!toEndpoint) {
            res.status(404).json({ error: 'To endpoint not found' });
            return;
        }

        if (!initiatorEndpoint) {
            res.status(404).json({ error: 'Initiator endpoint not found' });
            return;
        }

        if (initiatorEndpoint.channel !== Channel.call) {
            res.status(400).json({ error: 'Initiator endpoint must be a call endpoint' });
            return;
        }

        // Call Exotel API
        const exotelData = await exotelService.initiateCall(orgConfig.exotel, initiatorEndpoint.externalId, toEndpoint.externalId, finalFromEndPointExternalId);

        req.logger.info('Exotel response: %o', exotelData);

        const now = new Date();
        const newCall = await CallRecord.create({
            fromId: finalFromEndPointId,
            toId: toEndpoint.id,
            initiatorId: initiatorEndpoint.id,
            orgId: req.user.orgId,
            type: CallType.attempted,
            details: {
                exotelCallCreationDetails: exotelData,
            },
            createdBy: req.user.username,
            updatedBy: req.user.username,
            callStartTime: new Date(),
            createdAt: now,
            updatedAt: now
        });

        const response = await CallRecord.mapDBModel2Interface(newCall);
        
        logger.info('New call record created: %o', response);
        res.status(201).json({ call: response });

        // Start background thread to poll call status
        exotelService.pollCallStatus(orgConfig.exotel, exotelData.Sid, newCall, req.logger);

    } catch (error) {
        req.logger.error('Error creating call record: %o', error);
        res.status(503).json({ error: 'Internal Server Error' });
    }
});

router.get('/records', authenticateToken, authorize([UserScope.ReadOnlyUser]), endpointValidation, async (req: ExpressRequest, res: ExpressResponse) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        logger.warn('Validation errors', { errors: errors.array() });
        res.status(400).json({ errors: errors.array() });
        return;
    }

    try {
        const { endpointId, externalId } = req.query;

        if (!endpointId && !externalId) {
            res.status(400).json({ errors: 'Either endpointId or externalId is required' });
            return;
        }

        // Find endpoints that match the criteria
        const whereClause: WhereOptions = {
            orgId: req.user.orgId,
        };

        if (endpointId) {
            whereClause.id = endpointId as string;
        }

        if (externalId) {
            whereClause.externalId = { [Op.like]: `%${externalId}%` };
            whereClause.channel = Channel.call;
        }

        const endpoints = await EndpointModel.findAll({
            where: whereClause
        });

        if (endpoints.length === 0) {
            res.status(404).json({ error: 'No matching endpoints found' });
            return;
        }

        const endpointIds = endpoints.map(endpoint => endpoint.id);

        const callWhereClause = {
            [Op.or]: [
                { fromId: { [Op.in]: endpointIds } },
                { toId: { [Op.in]: endpointIds } },
                { initiatorId: { [Op.in]: endpointIds } }
            ]
        };

        const callRecords = await CallRecord.findAll({ where: callWhereClause });
        const callRecordsOutput = await Promise.all(callRecords.map((callRecord) => CallRecord.mapDBModel2Interface(callRecord)));
        res.status(200).json({callRecords: callRecordsOutput});
    } catch (error) {
        logger.error('Error fetching call records: %o', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
