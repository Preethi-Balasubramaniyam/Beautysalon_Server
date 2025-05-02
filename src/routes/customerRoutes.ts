import express from 'express';
import { literal, Op, UniqueConstraintError, ValidationError } from 'sequelize';
import DBCustomer, { CustomerAttributes } from '../models/customer'; // Import the customer model
import { authorize } from '../middleware/authorize';
import { UserScope } from '../types/userTypes';
import { CustomerInput, Customer, GetCustomerOutput } from '../types/customerTypes';
import { body, validationResult, query } from 'express-validator';
import normalizeParameters from '../middleware/paramNormalization'; // Import the normalization middleware
import DBInvoice from '../models/invoice'; // Import the invoice model
import DBEvent from '../models/event'; // Import the event model
import { Invoice } from '../types/invoiceTypes'; // Import Invoice type
import { Event } from '../types/eventTypes'; // Import Event type
import DBBranch from '../models/branch'; // Import the branch model
import { ZohoQueueProcessor } from '../zohoServices/zohoQueueProcessor';
import { Module } from '../types/queueTypes';

const router = express.Router();


const customerValidation = [
    body('name').notEmpty().withMessage('Name is required'),
    body('email').optional().isEmail().withMessage('Invalid email format'),
    body('mobile').notEmpty().isMobilePhone('any').withMessage('Valid Mobile is required'),
    body('city').optional().notEmpty().withMessage('City cannot be empty'),
    body('booksRefId').optional().notEmpty().withMessage('BooksRefId cannot be empty'),
    body('postalCode').notEmpty().withMessage('PostalCode is required'),
    body('address').optional().notEmpty().withMessage('Address cannot be empty'),
    body('defaultBranchId').optional().notEmpty().withMessage('DefaultBranchId cannot be empty'),
    body('dateOfBirth').optional().isISO8601({ strict: true, strictSeparator: true }).withMessage('Invalid date format, must be YYYY-MM-DD'),
    body('defaultBranchId').optional().isString().withMessage('DefaultBranchId must be a string').bail()
        .custom(async (value) => {
            if (value) {
                const branch = await DBBranch.findByPk(value);
                if (!branch) {
                    return Promise.reject('DefaultBranchId does not exist');
                }
            }
        }),
    body('gender').notEmpty().isIn(['m', 'f']).withMessage('Gender must be m or f'),
];

const customerUpdateValidation = [
    body('name').optional().notEmpty().withMessage('Name cannot be empty'),
    body('email').optional().isEmail().withMessage('Invalid email format').bail().optional({ checkFalsy: true }),
    body('mobile').optional().notEmpty().isMobilePhone('any').withMessage('Mobile cannot be empty'),
    body('booksRefId').optional().notEmpty().withMessage('BooksRefId cannot be empty'),
    body('postalCode').optional().notEmpty().withMessage('PostalCode cannot be empty'),
    body('defaultBranchId').optional().notEmpty().withMessage('DefaultBranchId cannot be empty'),
    body('dateOfBirth').optional().isISO8601({ strict: true, strictSeparator: true }).withMessage('Invalid date format, must be YYYY-MM-DD'),
    body('defaultBranchId').optional().isString().withMessage('DefaultBranchId must be a string').bail()
        .custom(async (value) => {
            if (value) {
                const branch = await DBBranch.findByPk(value);
                if (!branch) {
                    return Promise.reject('DefaultBranchId does not exist');
                }
            }
        }),
    body('gender').optional().isIn(['m', 'f']).withMessage('Gender must be m or f'),
];

router.get('/', authorize([UserScope.ReadOnlyUser]), [
    query('name').optional().isString(),
    query('mobile').optional().isString(),
    query('email').optional().isEmail(),
    query('booksRefId').optional().isString(),
    query('sortBy').optional().isIn(['name', 'mobile', 'email', 'booksRefId', 'postalCode', 'city', 'dateOfBirth', 'gender']).withMessage('Invalid sort field'), // Added dateOfBirth to sortBy
    query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Invalid sort order'),
    query('filter').optional().isString().withMessage('Filter must be a string'),
    query('page').optional().isInt({ min: 1 }).default(1),
    query('pageSize').optional().isInt({ min: 1 }).default(10)
], async (req: express.Request, res: express.Response) => {
    req.logger.info('Fetching customers with query: %o', req.query);

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        req.logger.warn('Validation errors', { errors: errors.array() });
        res.status(400).json({ errors: errors.array() });
        return;
    }

    const { name, mobile, email, booksRefId, sortBy, sortOrder, filter, page = 1, pageSize = 10 } = req.query as {
        name?: string;
        mobile?: string;
        email?: string;
        booksRefId?: string;
        sortBy?: string;
        sortOrder?: 'asc' | 'desc';
        filter?: string;
        page?: string;
        pageSize?: string;
    };

    try {
        let query: any = {
            orgId: req.user.orgId
        };

        if (name) query.name = { [Op.like]: `%${name}%` };
        if (mobile) query.mobile = { [Op.like]: `%${mobile}%` };
        if (email) query.email = { [Op.like]: `%${email}%` };
        if (booksRefId) query.booksRefId = { [Op.like]: `%${booksRefId}%` };
        if (filter) {
            query[Op.or] = [
                { name: { [Op.substring]: filter } },
                { mobile: { [Op.substring]: filter } },
                { email: { [Op.substring]: filter } },
                { postalCode: { [Op.substring]: filter } }, // Added postalCode to filter
                { city: { [Op.substring]: filter } }, // Added city to filter
                { dateOfBirth: { [Op.substring]: filter } }, // Added dateOfBirth to filter
                { gender: { [Op.substring]: filter } }
            ];
        }

        const pageNumber = parseInt(page as string);
        const size = parseInt(pageSize as string);
        const offset = (pageNumber - 1) * size;

        const { count, rows: customers } = await DBCustomer.findAndCountAll({
            where: query,
            limit: size,
            offset: offset,
            order: sortBy ? [[sortBy, sortOrder?.toUpperCase() || 'ASC']] : [['createdAt', 'DESC']]
        });

        const customerOutputs: Customer[] = customers.map(DBCustomer.mapDBModel2Interface);

        res.status(200).json({
            totalItems: count,
            totalPages: Math.ceil(count / size),
            currentPage: pageNumber,
            pageSize: size,
            customers: customerOutputs
        });
    } catch (error) {
        req.logger.error('Error retrieving data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.get('/:id', authorize([UserScope.ReadOnlyUser]), async (req: express.Request, res: express.Response) => {
    req.logger.info('Fetching customer with ID:', req.params.id);
    try {
        const { id } = req.params;
        const customer = await DBCustomer.findOne({
            where: {
                id: id,
                orgId: req.user.orgId // Ensure the customer belongs to the user's orgId
            }
        });
        if (customer) {
            const customerOutput: Customer = DBCustomer.mapDBModel2Interface(customer);

            // Fetch last 3 invoices
            const invoices = await DBInvoice.findAll({
                where: { customerId: id },
                limit: 3,
                order: [['createdAt', 'DESC']]
            });

            const invoiceOutputs: {id: string, date: Date, total: number}[] = invoices.map((invoice: DBInvoice) => ({ id: invoice.id, date: invoice.date, total: invoice.total }));

            // Fetch last 3 appointments (events)
            const pastEvents = await DBEvent.findAll({
                where: {
                    customerId: id,
                    startTime: {
                        [Op.lte]: new Date()
                    }
                },
                limit: 3,
                order: [['startTime', 'DESC']]
            });

            const upcomingEvents = await DBEvent.findAll({
                where: {
                    customerId: id,
                    startTime: {
                        [Op.gt]: new Date()
                    }
                },
                limit: 3,
                order: [['startTime', 'ASC']]
            });

            const allEvents = [...pastEvents, ...upcomingEvents];

            const eventOutputs: Event[] = allEvents.map(DBEvent.mapDBModel2Interface);

            // Calculate revenue for the last year
            const oneYearAgo = new Date();
            oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
            const revenueForLastYear = await DBInvoice.sum('total', {
                where: {
                    customerId: id,
                    date: {
                        [Op.gte]: oneYearAgo
                    }
                }
            });

            // Calculate revenue for the last month
            const oneMonthAgo = new Date();
            oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
            const revenueForLastMonth = await DBInvoice.sum('total', {
                where: {
                    customerId: id,
                    date: {
                        [Op.gte]: oneMonthAgo
                    }
                }
            });

            const output: GetCustomerOutput = {
                customer: customerOutput,
                invoices: invoiceOutputs,
                events: eventOutputs,
                revenueForLastYear: revenueForLastYear || 0,
                revenueForLastMonth: revenueForLastMonth || 0
            };

            res.status(200).json(output);
        } else {
            res.status(404).json({ error: 'Customer not found' });
        }
    } catch (error) {
        req.logger.error('Error retrieving data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.post('/', authorize([UserScope.ServiceProvider]), normalizeParameters, customerValidation, async (req: express.Request, res: express.Response) => {
    req.logger.info('Creating new customer with data:', req.body);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        req.logger.warn('Validation errors', { errors: errors.array() });
        res.status(400).json({ errors: errors.array() });
        return;
    }
    
    try {
        const input = DBCustomer.mapInterface2DBModel(req.body, req.user);
        const newCustomer: DBCustomer = await DBCustomer.create( input );
        const customerOutput: Customer = DBCustomer.mapDBModel2Interface(newCustomer);

        if (!customerOutput.booksRefId) {
            ZohoQueueProcessor.queueCreateOrUpdateItem(req.logger, req.user.orgId, customerOutput.id, Module.Customer, customerOutput);
        }

        res.status(201).json({ customer: customerOutput });
    } catch (error) {
        req.logger.error('Error posting data:', error);
        if (error instanceof UniqueConstraintError) {
            req.logger.warn('Unique key violation. Duplicate entry detected:', error);
            res.status(409).json({ error: 'Unique key violation. Duplicate entry detected.' });
        } else if (error instanceof ValidationError) {
            req.logger.warn('Invalid data. Please check your input:', error);
            res.status(400).json({ error: 'Invalid data. Please check your input.' });
        } else {
            req.logger.error('Error posting data:', error);    
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
});

router.put('/:id', authorize([UserScope.ServiceProvider]), normalizeParameters, customerUpdateValidation, async (req: express.Request, res: express.Response) => {
    req.logger.info('Updating customer with ID:', req.params.id, 'with data:', req.body);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        req.logger.warn('Validation errors', { errors: errors.array() });
        res.status(400).json({ errors: errors.array() });
        return;
    }

    const { name, email, mobile, city, booksRefId, postalCode, address, defaultBranchId, dateOfBirth, gender }: CustomerInput = req.body;
    try {
        const { id } = req.params;

        const updateFields: any = {};
        if (name !== undefined) updateFields.name = name;
        if (email !== undefined) updateFields.email = email ?? null;
        if (mobile !== undefined) updateFields.mobile = mobile;
        if (city !== undefined) updateFields.city = city ?? null;
        if (booksRefId !== undefined) updateFields.booksRefId = booksRefId ?? null;
        if (postalCode !== undefined) updateFields.postalCode = postalCode;
        if (address !== undefined) updateFields.address = address ?? null;
        if (defaultBranchId !== undefined) updateFields.defaultBranchId = defaultBranchId ?? null;
        if (dateOfBirth !== undefined) updateFields.dateOfBirth = dateOfBirth ?? null;
        if (gender !== undefined) updateFields.gender = gender;
        const customer: DBCustomer | null = await DBCustomer.findByPk(id);
        if (customer) {
            await customer.update(updateFields);
            const customerOutput: Customer = DBCustomer.mapDBModel2Interface(customer);
            // Queue the Zoho Books update in a background thread
            ZohoQueueProcessor.queueCreateOrUpdateItem(req.logger, req.user.orgId, customerOutput.id, Module.Customer, customerOutput);
            
            res.status(200).json({ customer: customerOutput });
        } else {
            res.status(404).json({ error: 'Customer not found' });
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

router.delete('/:id', authorize([UserScope.Admin]), async (req: express.Request, res: express.Response) => {
    req.logger.info('Deleting customer with ID:', req.params.id);
    try {
        const { id } = req.params;
        const customer = await DBCustomer.findByPk(id);
        if (customer) {
            const invoices = await DBInvoice.findAll({ where: { customerId: id } });
            if (invoices.length > 0) {
                res.status(400).json({ error: 'Cannot delete customer with existing invoices' });
                return;
            }
            await customer.destroy();
            // Queue the Zoho Books update in a background thread
            if (customer.booksRefId) {
                ZohoQueueProcessor.queueDeleteItem(req.logger, customer.booksRefId, Module.Customer);
            }

            res.status(204).json({ message: 'Customer deleted successfully' });
        } else {
            res.status(404).json({ error: 'Customer not found' });
        }
    } catch (error) {
        req.logger.error('Error deleting data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
