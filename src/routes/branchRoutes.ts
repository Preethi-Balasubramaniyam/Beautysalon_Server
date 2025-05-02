import express from 'express';
import DBBranch from '../models/branch';
import { Op, UniqueConstraintError, ValidationError } from 'sequelize';
import { authorize } from '../middleware/authorize';
import { UserScope } from '../types/userTypes';
import { body, validationResult, query } from 'express-validator';
import { BranchCreateRequest, BranchUpdateRequest, Branch, BranchDetailsResponse } from '../types/branchTypes'; // Import necessary types
import DBInvoice from '../models/invoice'; // Import the Invoice model
import DBEvent from '../models/event'; // Import the Event model
import { ZohoQueueProcessor } from '../zohoServices/zohoQueueProcessor';
import normalizeParameters from '../middleware/paramNormalization';
import { Module } from '../types/queueTypes';
import { Logger } from 'winston';

const router = express.Router();


router.get('/', authorize([UserScope.ReadOnlyUser]), [
    query('name').optional().isString(),
    query('sortBy').optional().isIn(['name', 'createdAt', 'postalCode', 'city', 'state', 'address', 'cashLedgerId', 'bankLedgerId']).withMessage('Invalid sort field'),
    query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Invalid sort order'),
    query('filter').optional().isString().withMessage('Filter must be a string'),
    query('page').optional().isInt({ min: 1 }).default(1),
    query('pageSize').optional().isInt({ min: 1 }).default(10)
], async (req: express.Request, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        req.logger.error('Validation errors:', errors.array());
        res.status(400).json({ errors: errors.array() });
        return;
    }

    const { name, sortBy, sortOrder, filter, page = '1', pageSize = '10' } = req.query as {
        name?: string;
        sortBy?: string;
        sortOrder?: 'asc' | 'desc';
        filter?: string;
        page?: string;
        pageSize?: string;
    };

    const query: any = { orgId: req.user.orgId }; // Ensure results are filtered by orgId
    if (name) {
        query.name = { [Op.like]: `%${name}%` };
    }
    if (filter) {
        query[Op.or] = [
            { name: { [Op.like]: `%${filter}%` } },
            { city: { [Op.like]: `%${filter}%` } },
            { state: { [Op.like]: `%${filter}%` } },
            { postalCode: { [Op.like]: `%${filter}%` } } // Added postalCode to filter
        ];
    }

    const pageNumber = parseInt(page);
    const size = parseInt(pageSize);
    const offset = (pageNumber - 1) * size;

    try {
        const { count, rows: branches } = await DBBranch.findAndCountAll({
            where: query,
            limit: size,
            offset: offset,
            order: sortBy ? [[sortBy, sortOrder?.toUpperCase() || 'ASC']] : [['createdAt', 'DESC']]
        });

        const branchResponses: Branch[] = branches.map(branch => DBBranch.fromDBModel(branch));
        req.logger.info('Fetched branches', { query, branches });

        res.status(200).json({
            totalItems: count,
            totalPages: Math.ceil(count / size),
            currentPage: pageNumber,
            pageSize: size,
            branches: branchResponses
        });
    } catch (error) {
        req.logger.error('Error fetching data', { error });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.get('/:id', authorize([UserScope.ReadOnlyUser]), async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    try {
        const branch = await DBBranch.findOne({ where: { id, orgId: req.user.orgId } }); // Ensure results are filtered by orgId
        if (!branch) {
            req.logger.warn('Branch not found', { id });
            res.status(404).json({ error: 'Branch ' + id + ' not found' });
            return;
        }
        const branchResponse = DBBranch.fromDBModel(branch);
        
        // Fetch additional details
        const thisMonthRevenue = await getTotalRevenueForMonth(id, req.logger);
        const last7daysRevenue = await getLast7DaysRevenue(id); // Changed to last7daysRevenue
        const next7daysAppointmentsCount = await getNext7DaysAppointmentsCount(id); // Changed to array
        const noOfActiveLeads = await getNoOfActiveLeads(id); // Added noOfActiveLeads

        const response: BranchDetailsResponse = {
            branch: branchResponse,
            thisMonthRevenue: thisMonthRevenue,
            last7daysRevenue: last7daysRevenue, // Changed to last7daysRevenue
            next7daysAppointmentsCount: next7daysAppointmentsCount, // Changed to array
            noOfActiveLeads: noOfActiveLeads // Added noOfActiveLeads
        };

        req.logger.info('Fetched branch details', { branch });
        res.status(200).json(response);
    } catch (error) {
        req.logger.error('Error fetching branch details %o', { error });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Mock functions for additional details
async function getTotalRevenueForMonth(branchId: string, logger: Logger): Promise<number> {
    // Implement the logic to fetch total revenue for the month using the Invoice table
    const startDate = new Date();
    startDate.setDate(1); // Set to the first day of the current month
    startDate.setHours(0, 0, 0, 0); // Set to beginning of day (00:00:00.000)

    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 1);
    endDate.setDate(0); // Set to the last day of the current month
    endDate.setHours(23, 59, 59, 999); // Set to end of day (23:59:59.999)

    logger.info('Getting total revenue for month: %o', { branchId, startDate, endDate });
    const totalRevenue = await DBInvoice.sum("total", {
        where: {
            branchId: branchId,
            date: {
                [Op.between]: [startDate, endDate]
            }
        }
    });

    return totalRevenue || 0; // Return 0 if no revenue found
}

async function getLast7DaysRevenue(branchId: string): Promise<number[]> {

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 6); // Set to 7 days ago

    const invoices = await DBInvoice.findAll({
        where: {
            branchId: branchId,
            date: {
                [Op.between]: [startDate, endDate]
            }
        },
        attributes: ['date', 'total'],
        order: [['date', 'ASC']]
    });

    const revenueByDay = Array(7).fill(0); // Initialize an array for 7 days with 0 revenue

    invoices.forEach(invoice => {
        const dayIndex = Math.floor((invoice.date.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))+1; //+1 is treat timesofar as the current day
        revenueByDay[dayIndex] += invoice.total;
    });

    return revenueByDay;
}

async function getNext7DaysAppointmentsCount(branchId: string): Promise<number[]> {
    // Implement the logic to fetch the number of appointments for the next 7 days using the Event table
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(startDate.getDate() + 7); // Set to 7 days from now

    const events = await DBEvent.findAll({
        where: {
            branchId: branchId,
            startTime: {
                [Op.between]: [startDate, endDate]
            }
        },
        attributes: ['startTime'],
        order: [['startTime', 'ASC']]
    });

    const appointmentsByDay = Array(7).fill(0); // Initialize an array for 7 days with 0 appointments

    events.forEach(event => {
        const dayIndex = Math.floor((event.startTime.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        appointmentsByDay[dayIndex] += 1;
    });

    return appointmentsByDay;
}

async function getNoOfActiveLeads(branchId: string): Promise<number> {
    // TODO: Implement the logic to fetch the number of active leads
    return 50; // Example value
}

router.post(
    '/',
    authorize([UserScope.Admin]),
    normalizeParameters,
    [
        body('name').notEmpty().withMessage('Name is required'),
        body('postalCode').notEmpty().withMessage('postalCode is required'),
        body('city').notEmpty().withMessage('City is required'),
        body('state').notEmpty().withMessage('State is required'),
        body('address').notEmpty().withMessage('Address is required'),
        body('cashLedgerId').notEmpty().withMessage('Books Cash Account ID is required'),
        body('bankLedgerId').notEmpty().withMessage('Books Bank Account ID is required'),
        body('commEndpoints').optional().isArray().withMessage('Communication Endpoints must be an array'),
    ],
    async (req: express.Request, res: express.Response): Promise<void> => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.logger.warn('Validation errors', { errors: errors.array() });
            res.status(400).json({ errors: errors.array() });
            return;
        }
        try {
            const createdBy = req.user.username;
            const orgId = req.user.orgId; // Get orgId from req.user
            const newBranch = await DBBranch.create(DBBranch.toDBCreateModel({ ...req.body, orgId } as BranchCreateRequest, req.user));
            const branchResponse = DBBranch.fromDBModel(newBranch);
            ZohoQueueProcessor.queueCreateOrUpdateItem(req.logger, req.user.orgId, newBranch.id, Module.Branch, branchResponse);
            req.logger.info('Branch created', { newBranch });
            res.status(201).json({ message: "Successfully added", branch: branchResponse});
        } catch (error) {
            if (error instanceof UniqueConstraintError) {
                req.logger.warn('Unique key violation', { error });
                res.status(409).json({ error: 'Unique key violation. Duplicate entry detected.' });
            } else if (error instanceof ValidationError) {
                req.logger.warn('Invalid data', { error });
                res.status(400).json({ error: 'Invalid data. Please check your input.' });
            } else {
                req.logger.error('Error posting data', { error });
                res.status(500).json({ error: 'Internal Server Error' });
            }
        }
    }
);

router.put(
    '/:id',
    authorize([UserScope.Admin]),
    normalizeParameters,
    [
        body('name').optional().notEmpty().withMessage('name cannot be empty'),
        body('postalCode').optional().notEmpty().withMessage('postalCode cannot be empty'),
        body('city').optional().notEmpty().withMessage('city cannot be empty'),
        body('state').optional().notEmpty().withMessage('state cannot be empty'),
        body('address').optional().notEmpty().withMessage('address cannot be empty'),
        body('cashLedgerId').optional().notEmpty().withMessage('Books Cash Account ID cannot be empty'), // Added validation for booksCashAccountId
        body('bankLedgerId').optional().notEmpty().withMessage('Books Bank Account ID cannot be empty'), // Added validation for booksBankAccountId
        body('commEndpoints').optional().isArray().withMessage('Communication Endpoints must be an array'), // Make commEndpoints optional
        body('orgId').optional().not().exists().withMessage('Organization ID cannot be updated'), // Do not allow updating orgId
    ],
    async (req: express.Request, res: express.Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.logger.warn('Validation errors', { errors: errors.array() });
            res.status(400).json({ errors: errors.array() });
            return;
        }
        const { id } = req.params;
        const { name, postalCode, city, state, address, cashLedgerId, bankLedgerId, commEndpoints } = req.body as BranchUpdateRequest; // Added commEndpoints and orgId
        if (!name && !postalCode && !city && !state && !address && !commEndpoints) {
            req.logger.warn('No fields provided for update');
            res.status(400).json({ error: 'At least one field must be provided for update.' });
            return;
        }
        try {
            const branch = await DBBranch.findByPk(id);
            if (!branch) {
                req.logger.warn('Branch not found', { id });
                res.status(404).json({ error: 'Branch ' + id + ' not found' });
                return;
            }
            if (branch.orgId !== req.user.orgId) {
                req.logger.warn('Unauthorized update attempt', { userOrgId: req.user.orgId, branchOrgId: branch.orgId });
                res.status(403).json({ error: 'You are not authorized to update this branch' });
                return;
            }
            if (name) branch.name = name;
            if (postalCode) branch.postalCode = postalCode;
            if (city) branch.city = city;
            if (state) branch.state = state;
            if (address) branch.address = address;
            if (cashLedgerId) branch.cashLedgerId = cashLedgerId; // Added booksCashAccountId
            if (bankLedgerId) branch.bankLedgerId = bankLedgerId; // Added booksBankAccountId
            if (commEndpoints) branch.commEndpoints = commEndpoints; // Added commEndpoints
            await branch.save();
            const branchResponse = DBBranch.fromDBModel(branch);
            ZohoQueueProcessor.queueCreateOrUpdateItem(req.logger, req.user.orgId, branch.id, Module.Branch, branchResponse);
            req.logger.info('Branch updated', { branch });
            res.status(200).json({ message: "Updated Branch", branch: branchResponse });
        } catch (error) {
            if (error instanceof ValidationError) {
                req.logger.warn('Invalid data', { error });
                res.status(400).json({ error: 'Invalid data. Please check your input.' });
            } else {
                req.logger.error('Error updating data', { error });
                res.status(500).json({ error: 'Internal Server Error' });
            }
        }
    }
);

router.delete('/:id', authorize([UserScope.Admin]), async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    res.status(501).json({ error: 'Unsupported operation' });
});

export default router;
