import express from 'express';
import { Op, UniqueConstraintError, ValidationError, Transaction, or, where } from 'sequelize';
import sequelize from '../models/database';
import DBInvoice from '../models/invoice';
import { InvoiceSaleItemAttributes } from '../models/invoiceSaleItem';
import DBInvoiceSaleItem from '../models/invoiceSaleItem';
import { authorize } from '../middleware/authorize';
import Customer from '../models/customer';
import { User, UserScope } from '../types/userTypes';
import ServiceProvider from '../models/serviceProvider';
import Branch from '../models/branch';
import { InvoiceInput, PaymentMode, Discount, InvoiceSaleItemInput, CustomerPaymentInput} from '../types/invoiceTypes';
import { body, query, param, validationResult } from 'express-validator';
import DBPayment from '../models/customerPayment';
import CustomerPayment from '../models/customerPayment';
import { ZohoQueueProcessor } from '../zohoServices/zohoQueueProcessor';
import normalizeParameters from '../middleware/paramNormalization';
import { ZohoInvoiceService } from '../zohoServices/zohoInvoiceService'; 
import { upload2S3 } from '../services/s3Service';
import { Module } from '../types/queueTypes';
import DBSaleItem from '../models/saleItem';

const router = express.Router();

const validateDiscount = (value: any) => {
    if (!Array.isArray(value)) {
        throw new Error('Discounts must be an array of discount objects');
    }
    const discountTypes = new Set();
    value.forEach((discount) => {
        if (typeof discount !== 'object' || discount === null || !('type' in discount) || !('value' in discount)) {
            throw new Error('Each discount must be a valid discount object with type and amount properties');
        }
        if (discount.value < 0) {
            throw new Error('Discount amount must be a positive number');
        }
        discountTypes.add(discount.type);
    });
    if (discountTypes.size > 1) {
        throw new Error('All discounts must be of the same type');
    }
    return true;
};

const validateInvoiceInput = [
    body('date').notEmpty().isISO8601().withMessage('Date is required and must be a valid date'),
    body('serviceProviderId').notEmpty().isString().withMessage('Service Provider ID is required and must be an integer'),
    body('customerId').notEmpty().isString().withMessage('Customer ID is required and must be an integer'),
    body('branchId').notEmpty().isString().withMessage('Branch ID is required and must be an integer'),
    body('invoiceSaleItems').isArray({ min: 1 }).withMessage('Sale Items are required')
        .custom(async (value) => {
            if (value) {
                await validateSaleItemRates(value);
            }
            return true;
        }),
    body('invoiceSaleItems.*.itemId').notEmpty().isString().withMessage('Item ID is required and must be an integer'),
    body('invoiceSaleItems.*.quantity').notEmpty().isInt().withMessage('Quantity is required and must be an integer'),
    body('invoiceSaleItems.*.rate').notEmpty().isFloat().withMessage('Rate is required and must be a number'),
    body('payments').optional().isArray().withMessage('Payments must be an array if provided'),
    body('payments.*.amount').notEmpty().isFloat().withMessage('Payment amount is required and must be a number'),
    body('payments.*.paymentMode').notEmpty().isIn(Object.values(PaymentMode)).withMessage('Payment method is required and must be one of Cash, Card, or UPI'),
    body('discounts').optional().isArray().withMessage('Discounts must be an object if provided')
        .custom(validateDiscount),
    body('roundOff').optional().isFloat().withMessage('Round off must be a number'), // Add this validation
    body('metaData').optional().isObject().withMessage('MetaData must be an object'), // Add this validation
    body('metaData.booksInvoiceJson').optional().isString().withMessage('Books Invoice JSON must be a string') // Add this validation
];

const calculateTotal = (invoiceSaleItems: InvoiceSaleItemInput[], discounts?: Discount[]): number => {
    let total = invoiceSaleItems.reduce((sum, item) => sum + (item.quantity * item.rate), 0);
    if (!discounts || discounts.length == 0) return total;
    
    let totalAmountDiscount = 0;
    let totalPercentageDiscount = 0;

    discounts.forEach((discount) => {
        if (discount.type === 'percentage') {
            totalPercentageDiscount += discount.value;
        } else if (discount.type === 'amount') {
            totalAmountDiscount += discount.value;
        }
    });

    total -= totalAmountDiscount;
    total -= total * (totalPercentageDiscount / 100);
    return total;
};

const validatePaymentsTotal = (payments: CustomerPaymentInput[] | CustomerPayment[], invoiceTotal: number) => {
    const totalPayments = payments.reduce((sum, payment) => sum + payment.amount, 0);
    if (totalPayments > invoiceTotal) {
        throw new Error('Total of payments cannot exceed the invoice total');
    }
};

const validateSaleItemRates = async (items: InvoiceSaleItemInput[]): Promise<void> => {
    for (const item of items) {
        const saleItem = await DBSaleItem.findByPk(item.itemId);
        if (!saleItem) {
            throw new Error(`Sale item ${item.itemId} not found`);
        }
        if (item.rate < saleItem.rate) {
            throw new Error(`Rate for item ${saleItem.name} cannot be less than base rate ${saleItem.rate}`);
        }
    }
};

// Create a new invoice
router.post(
    '/',
    authorize([UserScope.ServiceProvider]),
    normalizeParameters,
    validateInvoiceInput,
    async (req: express.Request, res: express.Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.logger.error('Validation errors:', errors.array());
            res.status(400).json({ errors: errors.array() });
            return;
        }
        const input: InvoiceInput = req.body;
        const serviceProvider = await ServiceProvider.findOne({
            where: { id: input.serviceProviderId, orgId: req.user.orgId}
        });
        if (!serviceProvider) {
            res.status(400).json({errors: 'Invalid service provider ID'});
            return;
        }

        const branch = await Branch.findOne({
            where: { id: input.branchId, orgId: req.user.orgId}
        });
        if (!branch) {
            res.status(400).json({errors: 'Invalid branch ID'});
            return;
        }

        const customer = await Customer.findOne({
            where: { id: input.customerId, orgId: req.user.orgId}
        });
        if (!customer) {
            res.status(400).json({errors: 'Invalid customer ID'});
            return;
        }
        
        const dryRun = req.query.dryRun === 'true';
        const totalWithoutRoundOff = calculateTotal(input.invoiceSaleItems, input.discounts);
        const total = totalWithoutRoundOff + (input.roundOff || 0); 
        if (input.roundOff && (input.roundOff < -0.1 * totalWithoutRoundOff || input.roundOff > 0.1 * totalWithoutRoundOff)) {
            res.status(400).json({ error: 'Round off must be between -10% and 10% of the total' });
            return;
        }
        if (input.payments) {
            validatePaymentsTotal(input.payments, total);
        }
        if (dryRun) {
            req.logger.info('Dry run: Invoice validated successfully');
            res.status(200).json({ message: 'Dry run: Invoice validated successfully', total });
            return;
        }
        const transaction: Transaction = await sequelize.transaction();
        let newInvoice: DBInvoice;
        try {
            const createdBy = req.user.username;
            newInvoice = await DBInvoice.create(DBInvoice.mapInterface2DBModel(input, total, req.user), { transaction });
            const saleItemsData: InvoiceSaleItemAttributes[] = input.invoiceSaleItems.map((item) => (DBInvoiceSaleItem.mapInterface2DBModel(item, newInvoice.id, createdBy)));
            const paymentData = input.payments?.map((payment) => DBPayment.toDBModelCreation(payment, input.customerId, newInvoice.id.toString(), createdBy));
            newInvoice.invoiceSaleItems = await DBInvoiceSaleItem.bulkCreate(saleItemsData, { transaction });
            newInvoice.payments = paymentData ? await DBPayment.bulkCreate(paymentData, { transaction }) : [];
            newInvoice.total = total;
            await newInvoice.save({ transaction });
            await transaction.commit();
        } catch (error: any) {
            await transaction.rollback();
            req.logger.error('Error creating invoice: %o', error);
            if (error instanceof UniqueConstraintError) {
                res.status(409).json({ error: 'Unique key violation. Duplicate entry detected.' });
            } else if (error instanceof ValidationError) {
                res.status(400).json({ error: 'Invalid data. Please check your input.' });
            } else if (error.message === 'Total of payments cannot exceed the invoice total') {
                res.status(400).json({ error: error.message });
            } else if (error.message === 'Discounts must be an array of discount objects' || 
                       error.message === 'Each discount must be a valid discount object with type and amount properties' || 
                       error.message === 'All discounts must be of the same type') {
                res.status(400).json({ error: error.message });
            } else {
                res.status(500).json({ error: 'Internal Server Error' });
            }
            return;
        }
        const fullInvoice = await DBInvoice.getFullInvoiceById(newInvoice.id, true, req.user.orgId);
        if (!fullInvoice) throw new Error('Invoice not found after creation');
        ZohoQueueProcessor.queueCreateOrUpdateItem(req.logger, req.user.orgId, fullInvoice.id, Module.Invoice, fullInvoice);
        req.logger.info('Invoice created successfully:', fullInvoice);
        res.status(201).json({invoice:fullInvoice});
    }
);

// Get all invoices with optional filtering and pagination
router.get(
    '/',
    authorize([UserScope.ReadOnlyUser]),
    [
        query('customerId').optional().isString().withMessage('Customer ID must be an integer'),
        query('branchId').optional().isInt().withMessage('Branch ID must be an integer'),
        query('serviceProviderId').optional().isInt().withMessage('Service Provider ID must be an integer'),
        query('startDate').optional().isISO8601().withMessage('Start Date must be a valid date'),
        query('endDate').optional().isISO8601().withMessage('End Date must be a valid date'),
        query('booksRefId').optional().isString().withMessage('Books Ref ID must be a string'),
        query('minTotal').optional().isFloat().withMessage('Min Total must be a number'),
        query('maxTotal').optional().isFloat().withMessage('Max Total must be a number'),
        query('sortBy').optional().isIn(['date', 'total', 'customerId', 'branchId', 'serviceProviderId']).withMessage('Invalid sort field'),
        query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Invalid sort order'),
        query('filter').optional().isString().withMessage('Filter must be a string'),
        query('page').optional().isInt({ min: 1 }).default(1),
        query('pageSize').optional().isInt({ min: 1 }).default(10)
    ],
    async (req: express.Request, res: express.Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.logger.error('Validation errors:', errors.array());
            res.status(400).json({ errors: errors.array() });
            return;
        }
        const { customerId, branchId, serviceProviderId, startDate, endDate, booksRefId, minTotal, maxTotal, sortBy, sortOrder, filter, page = 1, pageSize = 10 } = req.query as {
            customerId?: string;
            branchId?: string;
            serviceProviderId?: string;
            startDate?: string;
            endDate?: string;
            booksRefId?: string;
            minTotal?: string;
            maxTotal?: string;
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
            filter?: string;
            page?: string;
            pageSize?: string;
        };

        const whereClause: any = { orgId: req.user.orgId };
        if (customerId) whereClause.customerId = customerId;
        if (branchId) whereClause.branchId = branchId;
        if (serviceProviderId) whereClause.serviceProviderId = serviceProviderId;
        if (startDate && endDate) {
            whereClause.date = { [Op.between]: [new Date(startDate as string), new Date(endDate as string)] };
        } else if (startDate) {
            whereClause.date = { [Op.gte]: new Date(startDate as string) };
        } else if (endDate) {
            whereClause.date = { [Op.lte]: new Date(endDate as string) };
        }
        if (booksRefId) whereClause.booksRefId = booksRefId;
        if (minTotal && maxTotal) {
            whereClause.total = { [Op.between]: [parseFloat(minTotal as string), parseFloat(maxTotal as string)] };
        } else if (minTotal) {
            whereClause.total = { [Op.gte]: parseFloat(minTotal as string) };
        } else if (maxTotal) {
            whereClause.total = { [Op.lte]: parseFloat(maxTotal as string) };
        }
        if (filter) {
            whereClause[Op.or] = [
                { '$customer.name$': { [Op.like]: `%${filter}%` } },
                { '$branch.name$': { [Op.like]: `%${filter}%` } },
                { '$serviceProvider.name$': { [Op.like]: `%${filter}%` } },
                { '$invoiceSaleItems.saleItem.name$': { [Op.like]: `%${filter}%` } },
                { '$payments.paymentMode$': { [Op.like]: `%${filter}%` } },
                { '$customer.mobile$': { [Op.like]: `%${filter}%` } },
                { id: { [Op.like]: `%${filter}%` } },
                { booksRefId: { [Op.like]: `%${filter}%'` } },
                { customerId: { [Op.like]: `%${filter}%` } },
                { serviceProviderId: { [Op.like]: `%${filter}%` } },
                { branchId: { [Op.like]: `%${filter}%` } },
            ];
        }

        try {
            const offset = (parseInt(page as string) - 1) * parseInt(pageSize as string);
            const limit = parseInt(pageSize as string);
            const invoices = await DBInvoice.findAndCountAllFullInvoices(whereClause, offset, limit, sortBy, sortOrder);
            req.logger.info('Invoices fetched successfully');
            res.status(200).json({
                totalItems: invoices.count,
                totalPages: Math.ceil(invoices.count / parseInt(pageSize as string)),
                currentPage: parseInt(page as string),
                pageSize,
                invoices: invoices.rows
            });
        } catch (error) {
            req.logger.error('Error fetching invoices: %o', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
);

// Get a single invoice by ID
router.get(
    '/:id',
    authorize([UserScope.ReadOnlyUser]),
    [
        param('id').notEmpty().withMessage('ID must be there for get'),
        query('details').optional().isBoolean().withMessage('Details must be a boolean'),
    ],
    async (req: express.Request, res: express.Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.logger.error('Validation errors:', errors.array());
            res.status(400).json({ errors: errors.array() });
            return;
        }
        const { id } = req.params;
        const details = req.query.details === 'true';

        try {
            const invoice = await DBInvoice.getFullInvoiceById(id, details, req.user.orgId);
            if (invoice) {
                req.logger.info('Invoice fetched successfully:', invoice);
                res.status(200).json({ invoice: invoice });
            } else {
                res.status(404).json({ error: 'Invoice not found' });
            }
        } catch (error) {
            req.logger.error('Error fetching invoice:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
);

// Get invoice PDF URL from Zoho and upload to S3
router.get(
    '/:id/invoicePdf',
    authorize([UserScope.ReadOnlyUser]),
    param('id').notEmpty().withMessage('ID must be provided'),
    async (req: express.Request, res: express.Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.logger.error('Validation errors:', errors.array());
            res.status(400).json({ errors: errors.array() });
            return;
        }

        const { id } = req.params;

        try {
            const invoice = await DBInvoice.getFullInvoiceById(id, true, req.user.orgId);
            if (!invoice) {
                res.status(404).json({ error: 'Invoice not found' });
                return;
            }

            const invoiceSer = new ZohoInvoiceService(req.logger, req.user.orgId);
            if (!invoice.booksRefId) {
                res.status(400).json({ error: 'Invoice is not generated yet' });
                return;
            }
            const pdfUrl = await invoiceSer.getInvoicePdf(invoice.booksRefId);
            if (!pdfUrl) {
                res.status(500).json({ error: 'Failed to get PDF URL from Zoho' });
                return;
            }

            const s3Url = await upload2S3(pdfUrl, `invoices/${id}.pdf`, 'application/pdf');
            if (!s3Url) {
                res.status(500).json({ error: 'Failed to upload PDF to S3' });
                return;
            }

            req.logger.info('Invoice PDF URL fetched and uploaded to S3 successfully:', s3Url);
            res.status(200).json({ url: s3Url });
        } catch (error) {
            req.logger.error('Error fetching invoice PDF URL:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
);

// Update an invoice
router.put(
    '/:id',
    authorize([UserScope.Manager]),
    normalizeParameters,
    [
        param('id').notEmpty().withMessage('ID must be there'),
        body('date').optional().isISO8601().withMessage('Date must be a valid date if provided'),
        body('serviceProviderId').optional().notEmpty().withMessage('Service Provider ID must be an integer if provided')
            .custom(async (value) => {
                if (value) {
                    const serviceProvider = await ServiceProvider.findByPk(value);
                    if (!serviceProvider) return Promise.reject('Service Provider ID does not exist');
                }
            }),
        body('customerId').optional().notEmpty().withMessage('Customer ID must be an integer if provided')
            .custom(async (value) => {
                if (value) {
                    const customer = await Customer.findByPk(value);
                    if (!customer) return Promise.reject('Customer ID does not exist');
                }
            }),
        body('branchId').optional().notEmpty().withMessage('Branch ID must be an integer if provided')
            .custom(async (value) => {
                if (value) {
                    const branch = await Branch.findByPk(value);
                    if (!branch) return Promise.reject('Branch ID does not exist');
                }
            }),
        body('invoiceSaleItems').optional().isArray({ min: 1 }).withMessage('Sale Items must be an array if provided')
            .custom(async (value) => {
                if (value) {
                    await validateSaleItemRates(value);
                }
                return true;
            }),
        body('invoiceSaleItems.*.itemId').optional().notEmpty().withMessage('Item ID must be an integer if provided'),
        body('invoiceSaleItems.*.quantity').optional().notEmpty().isInt().withMessage('Quantity must be an integer if provided'),
        body('invoiceSaleItems.*.rate').optional().notEmpty().isFloat().withMessage('Rate must be a number if provided'),
        body('payments').optional().isArray().withMessage('Payments must be an array if provided'),
        body('payments.*.amount').optional().notEmpty().isFloat().withMessage('Payment amount must be a number if provided'),
        body('payments.*.paymentMode').notEmpty().isIn(Object.values(PaymentMode)).withMessage('Payment method is required and must be one of Cash, Card, or UPI'),
        body('discounts').optional().isArray().withMessage('Discounts must be an object if provided')
            .custom((value) => {
                if (typeof value !== 'object' || value === null) {
                    throw new Error('Discounts must be a valid object');
                }
                return true;
            }),
        body('roundOff').optional().isFloat().withMessage('Round off must be a number'), // Add this validation
        body('metaData').optional().isObject().withMessage('MetaData must be an object'), // Add this validation
        body('metaData.booksInvoiceJson').optional().isString().withMessage('Books Invoice JSON must be a string') // Add this validation
    ],
    async (req: express.Request, res: express.Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.logger.error('Validation errors:%o', errors.array());
            res.status(400).json({ errors: errors.array() });
            return;
        }

        const { date, serviceProviderId, customerId, branchId,  booksRefId, invoiceSaleItems, payments, discounts, roundOff, metaData }: InvoiceInput = req.body;
        const dryRun = req.query.dryRun === 'true';

        if (!date && !serviceProviderId && !customerId && !branchId && !booksRefId && !invoiceSaleItems && !payments && !discounts) {
            req.logger.error('No parameters provided for update');
            res.status(400).json({ error: 'No parameters provided for update' });
            return;
        }
        
        const { id } = req.params;
        const transaction: Transaction = await sequelize.transaction();

        try {
            const invoice = await DBInvoice.findOne({
                where: { id, orgId : req.user.orgId },
                include: [
                    { model: DBInvoiceSaleItem, as: 'invoiceSaleItems' },
                    { model: DBPayment, as: 'payments' },
                ]
            });
            if (invoice) {
                const updatedInvoiceSaleItems = invoiceSaleItems || invoice.invoiceSaleItems;
                const updatedDiscounts = discounts || invoice.discounts;
                const updatedRoundOff = roundOff !== undefined ? roundOff : (invoice.roundOff || 0);
                
                const totalWithoutRoundOff = calculateTotal(updatedInvoiceSaleItems, updatedDiscounts);
                const total = totalWithoutRoundOff + updatedRoundOff;

                if (roundOff && (roundOff < -0.1 * totalWithoutRoundOff || roundOff > 0.1 * totalWithoutRoundOff)) {
                    res.status(400).json({ error: 'Round off must be between -10% and 10% of the total' });
                    return;
                }
                if (payments) {
                    validatePaymentsTotal(payments, total);
                } else if (invoice.payments) {
                    validatePaymentsTotal(invoice.payments, total);
                }
                if (dryRun) {
                    req.logger.info('Dry run: Invoice validated successfully');
                    res.status(200).json({ message: 'Dry run: Invoice validated successfully', total });
                    await transaction.rollback();
                    return;
                }
                await invoice.update({
                    ...(date && { date: new Date(date) }),
                    ...(serviceProviderId && { serviceProviderId: serviceProviderId }),
                    ...(customerId && { customerId: customerId }),
                    ...(branchId && { branchId: branchId }),
                    ...(booksRefId && { booksRefId }),
                    ...(discounts && { discounts }),
                    ...(roundOff !== undefined && { roundOff }),
                    ...(metaData && { metaData }),
                    total, 
                    updatedBy: req.user.username
                }, { transaction });

                if (invoiceSaleItems) {
                    await validateSaleItemRates(invoiceSaleItems);
                    await DBInvoiceSaleItem.destroy({ where: { invoiceId: id }, transaction });
                    const saleItemsData = invoiceSaleItems.map((item) => DBInvoiceSaleItem.mapInterface2DBModel(item, invoice.id, req.user.username));
                    invoice.invoiceSaleItems = await DBInvoiceSaleItem.bulkCreate(saleItemsData, { transaction });
                }
                if (payments) {
                    await DBPayment.destroy({ where: { invoiceId: id }, transaction});
                    const paymentData = payments.map((payment) => 
                        DBPayment.toDBModelCreation(payment, invoice.customerId.toString(), invoice.id.toString(), req.user.username)
                    );
                    invoice.payments = await DBPayment.bulkCreate(paymentData, { transaction });
                }

                await transaction.commit();
                
            } else {
                await transaction.rollback();
                res.status(404).json({ error: 'Invoice not found' });
                return;
            }

            const updatedInvoice = await DBInvoice.getFullInvoiceById(id, true, req.user.orgId);
            if (updatedInvoice) {
                ZohoQueueProcessor.queueCreateOrUpdateItem(req.logger, req.user.orgId, updatedInvoice.id, Module.Invoice, updatedInvoice);
                req.logger.info('Invoice updated successfully:', updatedInvoice);
                res.status(200).json({invoice: updatedInvoice});
            } else {
                throw new Error('Updated invoice is null');
            }
        } catch (error: any) {
            await transaction.rollback();
            req.logger.error('Error updating invoice: %o', error);
            if (error.message === 'Total of payments cannot exceed the invoice total') {
                res.status(400).json({ error: error.message });
            } else if (error.message === 'Discounts must be an array of discount objects' || 
                       error.message === 'Each discount must be a valid discount object with type and amount properties' || 
                       error.message === 'All discounts must be of the same type' ||
                       error.message === 'Rate for item') { 
                res.status(400).json({ error: error.message });
            } else {
                res.status(500).json({ error: 'Internal Server Error' });
            }
            return;
        } 
    }
);

// Delete an invoice
router.delete(
    '/:id',
    authorize([UserScope.Admin]),
    [param('id').notEmpty().withMessage('ID is Mandatory for delete')],
    async (req: express.Request, res: express.Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.logger.error('Validation errors:', errors.array());
            res.status(400).json({ errors: errors.array() });
            return;
        }
        const { id } = req.params;
        const transaction: Transaction = await sequelize.transaction();

        try {
            const invoice = await DBInvoice.getFullInvoiceById(id, false, req.user.orgId);
            if (invoice) {
                await DBInvoiceSaleItem.destroy({ where: { invoiceId: id }, transaction });
                if (invoice.payments) await DBPayment.destroy({ where: { invoiceId: id }, transaction });
                await DBInvoice.destroy({ where: { id }, transaction });
                await transaction.commit();
                if (invoice.booksRefId)
                    await ZohoQueueProcessor.queueDeleteItem(req.logger, invoice.booksRefId, Module.Invoice);
                req.logger.info('Invoice deleted successfully:', id);
                res.status(204).send();
            } else {
                await transaction.rollback();
                res.status(404).json({ error: 'Invoice not found' });
            }
        } catch (error) {
            await transaction.rollback();
            req.logger.error('Error deleting invoice:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
);

export default router;
