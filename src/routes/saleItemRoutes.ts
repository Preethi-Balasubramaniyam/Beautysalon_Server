import express from 'express';
import { Op, UniqueConstraintError, ValidationError } from 'sequelize';
import DBSaleItem from '../models/saleItem';
import { authorize } from '../middleware/authorize';
import { UserScope } from '../types/userTypes';
import { SaleItemInput, SaleItem } from '../types/saleItemTypes';
import { body, query, param, validationResult } from 'express-validator';
import DBSaleItemCategory from '../models/saleItemCategory';
import { ZohoQueueProcessor } from '../zohoServices/zohoQueueProcessor';
import normalizeParameters from '../middleware/paramNormalization';
import { Module } from '../types/queueTypes';

const router = express.Router();




router.get('/', 
    authorize([UserScope.ReadOnlyUser]), 
    [
        query('name').optional().isString(),
        query('booksRefId').optional().isString(),
        query('sortBy').optional().isIn(['name', 'rate', 'booksRefId']).withMessage('Invalid sort field'),
        query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Invalid sort order'),
        query('filter').optional().isString().withMessage('Filter must be a string'),
        query('page').optional().isInt({ min: 1 }).default(1),
        query('pageSize').optional().isInt({ min: 1 }).default(10)
    ],
    async (req: express.Request, res: express.Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }

        const { name, booksRefId, sortBy, sortOrder, filter, page = '1', pageSize = '10' } = req.query as {
            name?: string;
            booksRefId?: string;
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
            filter?: string;
            page?: string;
            pageSize?: string;
        };

        let whereClause: any = {
            orgId: req.user.orgId // Add this line to filter by orgId
        };

        if (name) {
            whereClause.name = { [Op.like]: `%${name}%` };
        }
        if (booksRefId) {
            whereClause.booksRefId = booksRefId;
        }
        if (filter) {
            whereClause[Op.or] = [
                { name: { [Op.like]: `%${filter}%` } },
                { booksRefId: { [Op.like]: `%${filter}%` } }
            ];
        }

        const offset = (parseInt(page) - 1) * parseInt(pageSize);

        try {
            const { count, rows: saleItems } = await DBSaleItem.findAndCountAll({
                where: whereClause,
                limit: parseInt(pageSize),
                offset: offset,
                include: [{ model: DBSaleItemCategory, as: 'category' }],
                order: sortBy ? [[sortBy, sortOrder?.toUpperCase() || 'ASC']] : [['createdAt', 'DESC']]
            });
            req.logger.info(`Fetched ${saleItems.length} sale items`);
            res.status(200).json({
                totalItems: count,
                totalPages: Math.ceil(count / parseInt(pageSize)),
                currentPage: parseInt(page),
                pageSize: parseInt(pageSize),
                saleItems: saleItems.map(item => (DBSaleItem.fromDBModel(item)))
            });
        } catch (error) {
            req.logger.error('Failed to fetch sale items', error);
            res.status(500).json({ error: 'Failed to fetch sale items.' });
        }
    }
);

router.get('/:id', 
    authorize([UserScope.ReadOnlyUser]), 
    [
        param('id'),
        query('details').optional().isBoolean()
    ],
    async (req: express.Request, res: express.Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
             res.status(400).json({ errors: errors.array() });
             return;
        }

        try {
            const { id } = req.params;
            const details = req.query.details === 'true';
            const saleItem = await DBSaleItem.findOne({
                where: { id,
                    orgId: req.user.orgId
                },
                include: details ? [{ model: DBSaleItemCategory, as: 'category' }] : []
            });
            if (saleItem) {
                req.logger.info(`Fetched sale item: ${id}`);
                const response: SaleItem = DBSaleItem.fromDBModel(saleItem);
                res.status(200).json({saleItem:response});
            } else {
                req.logger.warn(`Sale item not found: ${id}`);
                res.status(404).json({ error: 'Sale item not found' });
            }
        } catch (error) {
            req.logger.error('Failed to fetch sale item', error);
            res.status(500).json({ error: 'Failed to fetch sale item.' });
        }
    }
);

router.post('/',
    authorize([UserScope.Manager]), 
    normalizeParameters,
    [
        body('name').notEmpty().isString(),
        body('rate').notEmpty().isFloat({ min: 0 }),
        body('categoryId').notEmpty(),
        body('booksRefId').optional().isString()
    ],
    async (req: express.Request, res: express.Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }

        try {
            const saleItemInput = req.body as SaleItemInput;
            const category = await DBSaleItemCategory.findByPk(saleItemInput.categoryId);
            if (!category) {
                req.logger.warn('Invalid categoryId. Category not found.');
                res.status(400).json({ error: 'Invalid categoryId. Category not found.' });
                return;
            }
            const newSaleItem: DBSaleItem = await DBSaleItem.create(DBSaleItem.fromInput(saleItemInput, req.user));
            // Queue update to booksItemData
            const response = DBSaleItem.fromDBModel(newSaleItem);
            response.category = DBSaleItemCategory.fromDBModel(category);
            
            //During add we dont expect booksRefId to be present. If it does present it should be from scripts
            if (saleItemInput.booksRefId == null || saleItemInput.booksRefId == "") {
                ZohoQueueProcessor.queueCreateOrUpdateItem(req.logger, req.user.orgId,newSaleItem.id, Module.Item, response); // Add this line
            }
            req.logger.info(`Sale item created: ${newSaleItem.id}`);
            res.status(201).json({saleItem: response});
        } catch (error) {
            if (error instanceof UniqueConstraintError) {
                req.logger.warn('Unique key violation while creating sale item', error);
                res.status(409).json({ error: 'Unique key violation. Duplicate entry detected.' });
            } else if (error instanceof ValidationError) {
                req.logger.warn('Validation error while creating sale item', error);
                res.status(400).json({ error: 'Invalid data. Please check your input.' });
            } else {
                req.logger.error('Failed to create sale item', error);
                res.status(500).json({ error: 'Failed to create sale item.' });
            }
        }
    }
);

router.put('/:id',
    authorize([UserScope.Manager]), 
    normalizeParameters,
    [
        param('id'),
        body('name').optional().isString(),
        body('rate').optional().isFloat({ min: 0 }),
        body('categoryId').optional().isString(),
        body('booksRefId').optional().isString()
    ],
    async (req: express.Request, res: express.Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }

        try {
            const { id } = req.params;
            const { name, rate, categoryId, booksRefId }: SaleItemInput = req.body;
            if (!name && !rate && !categoryId && !booksRefId) {
                req.logger.warn('No fields to update');
                res.status(400).json({ error: 'No fields to update' });
                return;
            }
            const saleItem = await DBSaleItem.findByPk(id);
            if (saleItem) {
                saleItem.name = name || saleItem.name;
                saleItem.rate = rate || saleItem.rate;
                saleItem.categoryId = categoryId || saleItem.categoryId;
                saleItem.booksRefId = booksRefId || saleItem.booksRefId;
                await saleItem.save();
                req.logger.info(`Sale item updated: ${id}`);
                const sItem = DBSaleItem.fromDBModel(saleItem);
                const cat = await DBSaleItemCategory.findByPk(saleItem.categoryId);
                if (!cat) {
                    req.logger.warn('Invalid categoryId. Category not found.');
                    res.status(400).json({ error: 'Invalid categoryId. Category not found.' });
                    return;
                }
                sItem.category = DBSaleItemCategory.fromDBModel(cat);
                ZohoQueueProcessor.queueCreateOrUpdateItem(req.logger, req.user.orgId, sItem.id, Module.Item,  sItem); // Add this line
                res.status(200).json({saleItem:sItem});
            } else {
                req.logger.warn(`Sale item not found: ${id}`);
                res.status(404).json({ error: 'Sale item not found' });
            }
        } catch (error) {
            if (error instanceof UniqueConstraintError) {
                req.logger.warn('Unique key violation while updating sale item', error);
                res.status(409).json({ error: 'Unique key violation. Duplicate entry detected.' });
            } else if (error instanceof ValidationError) {
                req.logger.warn('Validation error while updating sale item', error);
                res.status(400).json({ error: 'Invalid data. Please check your input.' });
            } else {
                req.logger.error('Failed to update sale item', error);
                res.status(500).json({ error: 'Failed to update sale item.' });
            }
        }
    }
);

router.delete('/:id', 
    authorize([UserScope.Manager]), 
    [
        param('id')
    ],
    async (req: express.Request, res: express.Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }

        try {
            const { id } = req.params;
            const saleItem = await DBSaleItem.findByPk(id);
            if (saleItem) {
                await saleItem.destroy();
                req.logger.info(`Sale item deleted: ${id}`);
                res.status(204).send();
            } else {
                req.logger.warn(`Sale item not found: ${id}`);
                res.status(404).json({ error: 'Sale item not found' });
            }
        } catch (error) {
            req.logger.error('Failed to delete sale item', error);
            res.status(500).json({ error: 'Failed to delete sale item.' });
        }
    }
);

export default router;
