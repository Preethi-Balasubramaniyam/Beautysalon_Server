import express from 'express';
import { Op, UniqueConstraintError, ValidationError, fn, col, where } from 'sequelize';
import ServiceProviderDB from '../models/serviceProvider';
import { authorize } from '../middleware/authorize';
import { UserScope } from '../types/userTypes';
import { 
    CreateServiceProviderRequest, 
    UpdateServiceProviderRequest, 
    GetSalesProviderOutput, 
} from '../types/serviceProviderTypes';
import ServiceProviderEventDB from '../models/event';    
import { body, param, query, validationResult } from 'express-validator';
import BranchDB from '../models/branch';
import normalizeParameters from '../middleware/paramNormalization';
import InvoiceDB  from '../models/invoice'; // Assuming you have an Invoice model
import { Event, EventType } from '../types/eventTypes'; // Import the Event interface
import { ZohoQueueProcessor } from '../zohoServices/zohoQueueProcessor';
import { Module } from '../types/queueTypes'; // Import the Module enum
const router = express.Router();


router.get(
    '/',
    authorize([UserScope.ReadOnlyUser]),
    [
        query('name').optional().isString(),
        query('branchId').optional().isInt(),
        query('mobile').optional().isString(),
        query('status').optional().isIn(['Active', 'InActive']),
        query('sortBy').optional().isIn(['name', 'branchId', 'mobile', 'status']).withMessage('Invalid sort field'),
        query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Invalid sort order'),
        query('filter').optional().isString().withMessage('Filter must be a string'),
        query('page').optional().isInt({ min: 1 }).default(1),
        query('pageSize').optional().isInt({ min: 1 }).default(10)
    ],
    async (req: express.Request, res: express.Response): Promise<void> => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }

        const { name, branchId, mobile, status, sortBy, sortOrder, filter, page = '1', pageSize = '10'} = req.query as {
            name?: string;
            branchId?: string;
            mobile?: string;
            status?: string;
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
            filter?: string;
            page?: string;
            pageSize?: string;
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const whereClause: any = {orgId : req.user.orgId};

        if (name) whereClause.name = { [Op.like]: `%${name}%` };
        if (branchId) whereClause.branchId = branchId;
        if (mobile) whereClause.mobile = { [Op.like]: `%${mobile}%` };
        if (status) whereClause.status = status;
        if (filter) {
            whereClause[Op.or] = [
                { name: { [Op.like]: `%${filter}%` } },
                { mobile: { [Op.like]: `%${filter}%` } },
                { status: { [Op.like]: `%{filter}%` } }
            ];
        }

        const pageNumber = parseInt(page);
        const size = parseInt(pageSize);
        const offset = (pageNumber - 1) * size;

        try {
            const { count, rows: serviceProviders } = await ServiceProviderDB.findAndCountAll({
                where: whereClause,
                include: [{ model: BranchDB, as: 'branch' }], // Include Branch object
                limit: size,
                offset: offset,
                order: sortBy ? [[sortBy, sortOrder?.toUpperCase() || 'ASC']] : [['createdAt', 'DESC']]
            });

            const response = serviceProviders.map(sp => {
                const serviceProvider = ServiceProviderDB.fromDBModel(sp);
                return serviceProvider;
            });
            req.logger.info('Fetched service providers', { count: serviceProviders.length });

            res.status(200).json({
                totalItems: count,
                totalPages: Math.ceil(count / size),
                currentPage: pageNumber,
                pageSize: size,
                serviceProviders: response
            });
        } catch (error) {
            req.logger.error('Failed to fetch beauticians', { error });
            res.status(500).json({ error: 'Failed to fetch beauticians.' });
        }
    }
);

router.get(
    '/:id',
    authorize([UserScope.ReadOnlyUser]),
    param('id'),
    async (req, res): Promise<void> => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }

        try {
            const { id } = req.params;
            const serviceProvider = await ServiceProviderDB.findOne({
                where: {
                    id,
                    orgId: req.user.orgId
                },
                include: [{ model: BranchDB, as: 'branch' }] // Include Branch object
            });
            if (serviceProvider) {
                const totalRevenueThisMonth = await calculateTotalRevenueThisMonth(serviceProvider.id, req);
                const last5AttendanceRecords = await getLast5AttendanceRecords(serviceProvider.id, req);
                const upcoming5Appointments = await getUpcoming5Appointments(serviceProvider.id, req);

                const response: GetSalesProviderOutput = {
                    serviceProvider: ServiceProviderDB.fromDBModel(serviceProvider),
                    totalRevenueThisMonth,
                    last5AttendanceRecords,
                    upcoming5Appointments,
                };

                req.logger.info('Fetched service provider', { id });
                res.status(200).json(response);
            } else {
                req.logger.warn('Service provider not found or unauthorized', { id });
                res.status(404).json({ error: 'Service provider not found or unauthorized' });
            }
        } catch (error) {
            req.logger.error('Failed to fetch service provider', { error });
            res.status(500).json({ error: 'Failed to fetch service provider.' });
        }
    }
);

// Define the helper functions to fetch the additional data
async function calculateTotalRevenueThisMonth(serviceProviderId: string, req: express.Request): Promise<number> {
    const currentMonth = new Date().getMonth() + 1; // getMonth() is zero-based
    const currentYear = new Date().getFullYear();

    try {
        const result = await InvoiceDB.findAll({
            attributes: [[fn('SUM', col('total')), 'totalRevenue']],
            where: {
                serviceProviderId,
                [Op.and]: [
                    where(fn('MONTH', col('date')), currentMonth),
                    where(fn('YEAR', col('date')), currentYear)
                ]
            }
        });

        return (result[0].get('totalRevenue') as number) || 0;
    } catch (error) {
        req.logger.error('Error calculating total revenue:', error);
        throw error;
    }
}

async function getLast5AttendanceRecords(serviceProviderId: string, req: express.Request): Promise<Event[]> {
    try {
        const attendanceRecords = await ServiceProviderEventDB.findAll({
            where: { 
                serviceProviderId,
                startTime: {
                    [Op.lte]: new Date()
                },
                eventType: { [Op.in]: [EventType.attendance] }
            },
            order: [['startTime', 'DESC']],
            limit: 5
        });
        return attendanceRecords.map(record => ServiceProviderEventDB.mapDBModel2Interface(record));
    } catch (error) {
        req.logger.error('Error fetching attendance records:', error);
        throw error;
    }
}

async function getUpcoming5Appointments(serviceProviderId: string, req: express.Request): Promise<Event[]> {
    try {
        const upcomingAppointments = await ServiceProviderEventDB.findAll({
            where: {
                serviceProviderId,
                startTime: {
                    [Op.gte]: new Date() // Only fetch future appointments
                },
                eventType: { [Op.in]: [EventType.appointment] }
            },
            order: [['startTime', 'ASC']],
            limit: 5
        });
        return upcomingAppointments.map(appointment => ServiceProviderEventDB.mapDBModel2Interface(appointment));
    } catch (error) {
        req.logger.error('Error fetching upcoming appointments:', error);
        throw error;
    }
}

router.post(
    '/',
    authorize([UserScope.Manager]),
    normalizeParameters,
    body('name').isString(),
    body('mobile').isString().isMobilePhone('any').withMessage('Must be valid mobile number'),
    body('branchId').custom(async (value) => {
        const branchId = await BranchDB.findByPk(value);
        if (!branchId) {
            return Promise.reject('Invalid branch ID');
        }
    }),
    body('status').isIn(['Active', 'InActive']),
    body('email').optional().isEmail(),
    body('experience').optional().isInt(),
    async (req, res): Promise<void> => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }

        const { name, email, mobile, branchId, status, experience } = req.body as CreateServiceProviderRequest;

        try {
            const newServiceProvider = await ServiceProviderDB.create(ServiceProviderDB.toDBModelForCreate({ name, email, mobile, branchId, status, experience}, req.user));
            const response = ServiceProviderDB.fromDBModel(newServiceProvider);
            ZohoQueueProcessor.queueCreateOrUpdateItem(req.logger, req.user.orgId, newServiceProvider.id, Module.ServiceProvider, response);
            req.logger.info('Created new service provider', { id: newServiceProvider.id });
            res.status(201).json({serviceProvider:response});
        } catch (error) {
            if (error instanceof UniqueConstraintError) {
                req.logger.warn('Unique key violation. Duplicate entry detected', { error });
                res.status(409).json({ error: 'Unique key violation. Duplicate entry detected.' });
            } else if (error instanceof ValidationError) {
                req.logger.warn('Invalid data. Please check your input', { error });
                res.status(400).json({ error: 'Invalid data. Please check your input.' });
            } else {
                req.logger.error('Failed to create beautician', { error });
                res.status(500).json({ error: 'Failed to create beautician.' });
            }
        }
    }
);

router.put(
    '/:id',
    authorize([UserScope.Manager]),
    normalizeParameters,
    param('id'),
    body('name').optional().isString(),
    body('mobile').optional().isString().isMobilePhone('any').withMessage('Mobile number must be 10 digits'),
    body('branchId').optional().custom(async (value) => {
        const branch = await BranchDB.findByPk(value);
        if (!branch) {
            return Promise.reject('Invalid branch ID');
        }
    }),
    body('status').optional().isIn(['Active', 'InActive']),
    body('email').optional().isEmail(),
    body('booksRefId').optional().isString(),
    body('experience').optional().isInt(),
    async (req, res): Promise<void> => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.logger.warn('Validation errors', { errors: errors.array() });
            res.status(400).json({ errors: errors.array() });
            return;
        }
        try {
            const { id } = req.params;
            const { name, email, mobile, branchId, booksRefId, status, experience } = req.body as UpdateServiceProviderRequest;
            const updatedBy = req.user.username;
            const serviceProvider = await ServiceProviderDB.findByPk(id);

            if (!serviceProvider) {
                res.status(404).json({ error: 'Service provider not found' });
                return;
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const fieldsToUpdate: any = {};
            if (name) fieldsToUpdate.name = name;
            if (email) fieldsToUpdate.email = email;
            if (mobile) fieldsToUpdate.mobile = mobile;
            if (branchId) fieldsToUpdate.branchId = branchId;
            if (booksRefId) fieldsToUpdate.booksRefId = booksRefId;
            if (status) fieldsToUpdate.status = status;
            if (experience !== undefined) fieldsToUpdate.experience = parseInt(experience.toString(), 10);
            fieldsToUpdate.updatedBy = updatedBy;

            if (Object.keys(fieldsToUpdate).length === 0) {
                res.status(400).json({ error: 'No fields to update.' });
                return;
            }

            await serviceProvider.update(req.body);
            const response = ServiceProviderDB.fromDBModel(serviceProvider);
            ZohoQueueProcessor.queueCreateOrUpdateItem(req.logger, req.user.orgId,  serviceProvider.id, Module.ServiceProvider, response);
            req.logger.info('Updated service provider', { id });
            res.status(200).json({serviceProvider:response});
        } catch (error) {
            if (error instanceof UniqueConstraintError) {
                req.logger.warn('Unique key violation. Duplicate entry detected', { error });
                res.status(409).json({ error: 'Unique key violation. Duplicate entry detected.' });
            } else if (error instanceof ValidationError) {
                req.logger.warn('Invalid data. Please check your input', { error });
                res.status(400).json({ error: 'Invalid data. Please check your input.' });
            } else {
                req.logger.error('Failed to update service provider', { error });
                res.status(500).json({ error: 'Failed to update service provider.' });
            }
        }
    }
);

router.delete(
    '/:id',
    authorize([UserScope.Admin]),
    param('id'),
    async (req, res): Promise<void> => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ error: errors.array().map(err => `${err.type}: ${err.msg}`).join(', ') });
            return;
        }
        try {
            const { id } = req.params;
            const serviceProvider = await ServiceProviderDB.findByPk(id);
            if (serviceProvider) {
                await serviceProvider.destroy();
                if (serviceProvider.booksRefId) {
                    ZohoQueueProcessor.queueDeleteItem(req.logger, serviceProvider.booksRefId, Module.ServiceProvider);
                }
                req.logger.info('Deleted service provider', { id });
                res.status(204).json({ message: 'Service provider deleted successfully' });
            } else {
                req.logger.warn('Service provider not found', { id });
                res.status(404).json({ error: 'Service provider not found' });
            }
        } catch (error) {
            req.logger.error('Failed to delete service provider', { error });
            res.status(500).json({ error: 'Failed to delete service provider.' });
        }
    }
);

export default router;
