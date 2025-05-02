import express from 'express';
import { Op, UniqueConstraintError, ValidationError } from 'sequelize';
import DBSaleItemCategory from '../models/saleItemCategory';
import { authorize } from '../middleware/authorize';
import { UserScope } from '../types/userTypes';
import { SaleItemCategoryInput } from '../types/saleItemTypes';
import { body, query, param, validationResult } from 'express-validator';
import normalizeParameters from '../middleware/paramNormalization';

const router = express.Router();

router.get('/', 
    authorize([UserScope.ReadOnlyUser]), 
    [
        query('hsnSacCode').optional().isString(),
        query('name').optional().isString(),
        query('type').optional().isString(),
        query('page').optional().isInt({ min: 1 }),
        query('pageSize').optional().isInt({ min: 1 }),
        query('sortBy').optional().isString(),
        query('sortOrder').optional().isIn(['asc', 'desc'])
    ],
    async (req: express.Request, res: express.Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }

        const params = {
            hsnSacCode: req.query.hsnSacCode as string,
            name: req.query.name as string,
            type: req.query.type as string,
            page: parseInt(req.query.page as string) || 1,
            pageSize: parseInt(req.query.pageSize as string) || 10,
            sortBy: req.query.sortBy as string,
            sortOrder: req.query.sortOrder as 'asc' | 'desc' || 'asc'
        }; 
        
        let whereClause: any = {
            orgId: req.user.orgId // added orgId to whereClause
        };

        if (params.hsnSacCode) {
            whereClause.hsnSacCode = { [Op.like]: `%${params.hsnSacCode}%` };
        }
        if (params.name) {
            whereClause.name = { [Op.like]: `%${params.name}%` };
        }
        if (params.type) {
            whereClause.type = params.type;
        }

        const offset = (params.page - 1) * params.pageSize;
        const order: [string, 'asc' | 'desc'][] = params.sortBy ? [[params.sortBy, params.sortOrder]] : [['createdAt', 'desc']];

        try {
            const { count, rows: categories } = await DBSaleItemCategory.findAndCountAll({
                where: whereClause,
                limit: params.pageSize,
                offset: offset,
                order: order
            });
            req.logger.info(`Fetched ${categories.length} categories`);
            res.status(200).json({
                totalItems: count,
                totalPages: Math.ceil(count / params.pageSize),
                currentPage: params.page,
                pageSize: params.pageSize,
                categories: categories.map(category => (DBSaleItemCategory.fromDBModel(category)))
            });
            req.logger.info(`Fetched categories: ${categories.length}`); // Add logging
        } catch (error) {
            req.logger.error('Failed to fetch categories', error);
            res.status(500).json({ error: 'Failed to fetch categories.' });
        }
    }
);

router.post('/', 
    authorize([UserScope.Manager]), 
    normalizeParameters,
    [
        body('hsnSacCode').notEmpty().isString(),
        body('name').notEmpty().isString(),
        body('description').optional().isString(),
        body('type').notEmpty().isIn(['service', 'product']),
        body('taxPercent').notEmpty()
    ],
    async (req: express.Request, res: express.Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }

        const input: SaleItemCategoryInput = req.body;

        // Cast taxPercent to float if it is a string and validate if it is castable to float
        if (typeof input.taxPercent === 'string') {
            const parsedTaxPercent = parseFloat(input.taxPercent);
            if (isNaN(parsedTaxPercent)) {
                res.status(400).json({ error: 'Invalid taxPercent. It should be a number between 0 and 100.' });
                return;
            }
            input.taxPercent = parsedTaxPercent;
        }

        // Validate taxPercent
        if (typeof input.taxPercent !== 'number' || input.taxPercent < 0 || input.taxPercent > 100) {
            res.status(400).json({ error: 'Invalid taxPercent. It should be a number between 0 and 100.' });
            return;
        }

        // Validate type
        const validTypes = ['service', 'product'];
        if (!validTypes.includes(input.type)) {
            res.status(400).json({ error: `Invalid type. Valid types are: ${validTypes.join(', ')}` });
            return;
        }

        try {
            const newCategory: DBSaleItemCategory = await DBSaleItemCategory.create(DBSaleItemCategory.fromInput(input, req.user));
            req.logger.info(`Category created: ${newCategory.id}`);
            res.status(201).json({category: DBSaleItemCategory.fromDBModel(newCategory)});
        } catch (error) {
            if (error instanceof UniqueConstraintError) {
                req.logger.warn('Unique key violation while creating category', error);
                res.status(409).json({ error: 'Unique key violation. Duplicate entry detected.' });
            } else if (error instanceof ValidationError) {
                req.logger.warn('Validation error while creating category', error);
                res.status(400).json({ error: 'Invalid data. Please check your input.' });
            } else {
                req.logger.error('Failed to create category', error);
                res.status(500).json({ error: 'Failed to create category.' });
            }
        }
    }
);

export default router;