import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { authorize } from '../middleware/authorize';
import { UserScope } from '../types/userTypes';
import { Ledger, LedgerCreateRequest, LedgerType } from "../types/ledgerTypes";
import DBLedger from '../models/ledger'; // Import the renamed DB model
import { Op, UniqueConstraintError } from 'sequelize';
import { Module } from '../types/queueTypes'; // Import the Module enum or constant
import { ZohoQueueProcessor } from '../zohoServices/zohoQueueProcessor';
import normalizeParameters from '../middleware/paramNormalization';


const router = express.Router();

// Get ledger by ID
router.get('/:id', authorize([UserScope.ReadOnlyUser]), async (req: express.Request, res: express.Response) => {
    const { id } = req.params;

    try {
        const ledger = await DBLedger.findByPk(id);
        
        if (!ledger) {
            req.logger.warn('Ledger not found', { id });
            res.status(404).json({ error: 'Ledger not found' });
            return;
        }

        // Check if the ledger belongs to the user's organization
        if (ledger.orgId !== req.user.orgId) {
            req.logger.warn('Unauthorized access to ledger', { id, userOrgId: req.user.orgId, ledgerOrgId: ledger.orgId });
            res.status(403).json({ error: 'Unauthorized access to this ledger' });
            return;
        }

        const ledgerOutput: Ledger = DBLedger.mapDBModel2Interface(ledger);
        req.logger.info('Fetched ledger by ID', { id });
        
        res.status(200).json({ ledger: ledgerOutput });
    } catch (error) {
        req.logger.error('Error fetching ledger by ID', { id, error });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.get('/', authorize([UserScope.ReadOnlyUser]), [
    query('name').optional().isString(),
    query('type').optional().isIn(Object.values(LedgerType)),
    query('booksRefId').optional().isString(),
    query('sortBy').optional().isIn(['name', 'type', 'booksRefId']).withMessage('Invalid sort field'),
    query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Invalid sort order'),
    query('filter').optional().isString().withMessage('Filter must be a string'),
    query('page').optional().isInt({ min: 1 }).default(1),
    query('pageSize').optional().isInt({ min: 1 }).default(10),
], async (req: express.Request, res: express.Response) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.logger.error('Validation errors:', errors.array());
            res.status(400).json({ errors: errors.array() });
            return;
        }

        const { name, type, booksRefId, sortBy, sortOrder, filter, page = 1, pageSize = 10 } = req.query as {
            name?: string;
            type?: string;
            booksRefId?: string;
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
            filter?: string;
            page?: string;
            pageSize?: string;
            orgId?: string;
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const filters: any = {};
        if (name) filters.name = name;
        if (type) filters.type = type;
        if (booksRefId) filters.booksRefId = booksRefId;
        if (filter) {
            filters[Op.or] = [
                { name: { [Op.like]: `%${filter}%` } },
                { type: { [Op.like]: `%${filter}%` } },
                { booksRefId: { [Op.like]: `%${filter}%` } }
            ];
        }
        filters.orgId = req.user.orgId; // Added orgId filter

        const pageNumber = parseInt(page as string);
        const size = parseInt(pageSize as string);
        const offset = (pageNumber - 1) * size;

        const { count, rows: dbLedgers } = await DBLedger.findAndCountAll({
            where: filters,
            order: sortBy ? [[sortBy, sortOrder?.toUpperCase() || 'ASC']] : undefined,
            limit: size,
            offset: offset
        });

        const ledgers: Ledger[] = dbLedgers.map(account => DBLedger.mapDBModel2Interface(account));
        req.logger.info('Fetched branch account details', { ledgers });

        res.status(200).json({
            totalItems: count,
            totalPages: Math.ceil(count / size),
            currentPage: pageNumber,
            pageSize: size,
            ledgers
        });
    } catch (error) {
        req.logger.error('Error fetching branch account details', { error });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Create Account
router.post(
    '/',
    authorize([UserScope.Admin]),
    normalizeParameters,
    [
        body('name').notEmpty().withMessage('Name is required'),
        body('type').isIn(Object.values(LedgerType)).withMessage('Type must be either cash or bank'), // Use enum values
        body('booksRefId').optional().notEmpty().withMessage('Books Ref ID is required'), // Added validation for booksRefId
    ],
    async (req: express.Request, res: express.Response): Promise<void> => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.logger.warn('Validation errors', { errors: errors.array() });
            res.status(400).json({ errors: errors.array() });
            return;
        }

        try {
            const input = DBLedger.mapInterface2DBModel(req.body as LedgerCreateRequest, req.user);
            const newLedger = await DBLedger.create(input);
            req.logger.info('Branch account details created %o', { newLedger });

            const ledgerOutput: Ledger = DBLedger.mapDBModel2Interface(newLedger);

            if (!newLedger.booksRefId || newLedger.booksRefId === '') {
                ZohoQueueProcessor.queueCreateOrUpdateItem(req.logger, req.user.orgId, ledgerOutput.id, Module.Account, ledgerOutput); // Queue the account create or update
            }

            res.status(201).json({ message: "Successfully added", ledger: ledgerOutput});
        } catch (error) {
            if (error instanceof UniqueConstraintError) {
                req.logger.warn('Unique constraint error', { error });
                res.status(400).json({ error: 'Account with the same name or booksRefId already exists for the given orgId' });
            } else {
                req.logger.error('Error creating branch account details', { error });
                res.status(500).json({ error: 'Internal Server Error' });
            }
        }
    }
);

// Update Account
router.put(
    '/:id',
    authorize([UserScope.Admin]),
    normalizeParameters,
    [
        body('name').optional().notEmpty().withMessage('Name cannot be empty'),
        body('type').optional().isIn(Object.values(LedgerType)).withMessage('Type must be either cash or bank'), // Use enum values
        body('booksRefId').optional().notEmpty().withMessage('Books Ref ID cannot be empty'), // Added validation for booksRefId
    ],
    async (req: express.Request, res: express.Response): Promise<void> => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            req.logger.warn('Validation errors', { errors: errors.array() });
            res.status(400).json({ errors: errors.array() });
            return;
        }

        const { id } = req.params;
        const { name, type, booksRefId } = req.body as Partial<LedgerCreateRequest>;
        const orgId = req.body.orgId; // Added orgId update

        try {
            const ledger = await DBLedger.findByPk(id);
            if (!ledger) {
                req.logger.warn('Ledger details not found', { id });
                res.status(404).json({ error: 'Ledger details not found' });
                return;
            }

            if (name) ledger.name = name;
            if (type) ledger.type = type;
            if (booksRefId) ledger.booksRefId = booksRefId;
            if (orgId) ledger.orgId = orgId; // Added orgId update
            ledger.updatedBy = req.user.username;

            await ledger.save();
            req.logger.info('Ledger details updated', { account: ledger });

            const ledgerOutput: Ledger = DBLedger.mapDBModel2Interface(ledger);
            ZohoQueueProcessor.queueCreateOrUpdateItem(req.logger, req.user.orgId, ledgerOutput.id, Module.Account, ledgerOutput)
            res.status(200).json({ message: "Ledger Details", ledger: ledgerOutput});
        } catch (error) {
            if (error instanceof UniqueConstraintError) {
                req.logger.warn('Unique constraint error', { error });
                res.status(400).json({ error: 'Account with the same name or booksRefId already exists for the given orgId' });
            } else {
                req.logger.error('Error updating ledger', { error });
                res.status(500).json({ error: 'Internal Server Error' });
            }
        }
    }
);

// Delete Account
router.delete('/:id', authorize([UserScope.Admin]), async (req: express.Request, res: express.Response) => {
    const { id } = req.params;

    try {
        const ledger = await DBLedger.findByPk(id);
        if (!ledger) {
            req.logger.warn('Ledger details not found', { id });
            res.status(404).json({ error: 'Ledger details not found' });
            return;
        }

        await ledger.destroy();
        req.logger.info('Ledger details deleted', { id });
        res.status(200).json({ message: "Deleted Ledger" });
    } catch (error) {
        req.logger.error('Error deleting ledger', { error });
        res.status(500).json({ error: 'Internal Server Error' });
    }
});



export default router;