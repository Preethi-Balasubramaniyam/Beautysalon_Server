import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { Offer, OfferInput } from '../types/offerTypes';
import DBOffer, { OfferSaleItemMap } from '../models/offer';
import SaleItemModel from '../models/saleItem';
import logger from '../common/logger';
import { Op } from 'sequelize';
import express from 'express';
import { authorize } from '../middleware/authorize';
import { UserScope } from '../types/userTypes';

const router = Router();

// Middleware for validation
const validateOffer: express.RequestHandler[] = [
    body('name').isString().notEmpty(),
    body('rate').isNumeric(),
    body('saleItemIds').isArray().notEmpty(),
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }
        next();
    },
];

// Create a new offer
router.post('/', authorize([UserScope.Manager]), validateOffer, async (req: express.Request, res: express.Response) => {
    try {
        const offerInput: OfferInput = req.body;
        const newOffer = await DBOffer.create(DBOffer.fromInput(offerInput, req.user));
        const saleItemMappings = offerInput.saleItemIds.map(saleItemId => ({
            offerId: newOffer.id,
            saleItemId,
        }));
        await OfferSaleItemMap.bulkCreate(saleItemMappings);

        const createdOffer = await DBOffer.findByPk(newOffer.id, {
            include: [{
                model: SaleItemModel,
                as: 'saleItems',
            }],
        });
        const response = createdOffer ? DBOffer.fromDBModel(createdOffer) : null;
        logger.info(`Offer created with ID: ${newOffer.id}`);
        res.status(201).json({ offer: response });
    } catch (error: any) {
        logger.error(`Error creating offer: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Get all offers with pagination and filtering
router.get(
    '/',
    authorize([UserScope.ReadOnlyUser]),
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('size').optional().isInt({ min: 1 }).toInt(),
        query('filter').optional().isString(),
    ],
    async (req: express.Request, res: express.Response) => {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const size = parseInt(req.query.size as string) || 10;
            const nameFilter = req.query.name ? { name: { [Op.like]: `%${req.query.filter}%` } } : {};

            const { count, rows } = await DBOffer.findAndCountAll({
                where: nameFilter,
                limit: size,
                offset: (page - 1) * size,
                include: [{
                    model: SaleItemModel,
                    as: 'saleItems',
                }],
            });

            res.status(200).json({
                totalItems: count,
                totalPages: Math.ceil(count / size),
                currentPage: page,
                pageSize: size,
                offers: rows,
            });
        } catch (error: any) {
            logger.error(`Error fetching offers: ${error.message}`);
            res.status(500).json({ error: error.message });
        }
    }
);

// Get all offers and sale items with pagination
router.get(
    '/combined',
    authorize([UserScope.ReadOnlyUser]),
    [
        query('page').optional().isInt({ min: 1 }).toInt(),
        query('size').optional().isInt({ min: 1 }).toInt(),
        query('filter').optional().isString(),
    ],
    async (req: express.Request, res: express.Response) => {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const size = parseInt(req.query.size as string) || 10;
            const filter = req.query.filter || '';
            const offset = (page - 1) * size;

            const [results, metadata] = await DBOffer.sequelize!.query(`
                SELECT id, name, type, rate, categoryId FROM (
                    SELECT 'offer' as type, id, name, rate, 'combined_offer' as categoryId
                    FROM Offers
                    UNION ALL
                    SELECT 'sale_item' as type, id, name, rate,  categoryId as categoryId
                    FROM SaleItems
                ) as combined
                where name like :filter
                ORDER BY name ASC
                LIMIT :limit OFFSET :offset
            `, {
                replacements: { limit: size, offset: offset, filter: `%${filter}%` },
            });

            req.logger.info(`Query metadata: ${JSON.stringify(metadata)}`);
            req.logger.info(`Query results: ${JSON.stringify(results)}`);

            const totalCount = await DBOffer.sequelize!.query(`
                SELECT COUNT(*) as count
                FROM (
                    SELECT id,name FROM offers
                    UNION ALL
                    SELECT id,name FROM SaleItems
                ) as combined
                where name like :filter
            `, { plain: true, replacements: { filter: `%${filter}%` } }) ?? { count: 0 };
            const count = totalCount.count as number; 
            // Add saleItems for offers
            for (const row of results as any[]) {
                if (row.type === 'offer') {
                    const offerSaleItems = await DBOffer.findByPk(row.id, {
                        include: [{
                            model: SaleItemModel,
                            as: 'saleItems',
                        }],
                    });
                    row.saleItems = offerSaleItems?.saleItems || [];
                }
            }

            res.status(200).json({
                totalItems: count,
                totalPages: Math.ceil(count / size),
                currentPage: page,
                pageSize: size,
                items: results
            });
        } catch (error: any) {
            logger.error(`Error fetching combined items: ${error.message}`);
            res.status(500).json({ error: error.message });
        }
    }
);

// Get an offer by ID
router.get('/:id', authorize([UserScope.ReadOnlyUser]), param('id').isUUID(), async (req, res) => {
    try {
        const offer = await DBOffer.findByPk(req?.params?.id, {
            include: [{
                model: SaleItemModel,
                as: 'saleItems',
            }],
        });
        if (offer) {
            res.status(200).json(offer);
        } else {
            res.status(404).json({ error: 'Offer not found' });
        }
    } catch (error: any) {
        logger.error(`Error fetching offer: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Update an offer by ID
router.put('/:id', authorize([UserScope.Manager]), param('id').isUUID(), validateOffer, async (req: express.Request, res: express.Response) => {
    try {
        const offerInput: Partial<OfferInput> = req.body;
        const user = req.user;
        const updateFields = {
            ...(offerInput.name && { name: offerInput.name }),
            ...(offerInput.rate !== undefined && { rate: offerInput.rate }),
            updatedBy: user.username
        };

        const [updated] = await DBOffer.update(updateFields, {
            where: { id: req.params.id },
        });

        if (updated) {
            // Update sale item mappings only if saleItemIds is provided
            if (offerInput.saleItemIds) {
                await OfferSaleItemMap.destroy({ where: { offerId: req.params.id } });
                const saleItemMappings = offerInput.saleItemIds.map(saleItemId => ({
                    offerId: req.params.id,
                    saleItemId,
                }));
                await OfferSaleItemMap.bulkCreate(saleItemMappings);
            }

            const updatedOffer = await DBOffer.findByPk(req.params.id, {
                include: [{
                    model: SaleItemModel,
                    as: 'saleItems',
                }],
            });

            logger.info(`Offer updated with ID: ${req.params.id}`);
            res.status(200).json(updatedOffer);
        } else {
            res.status(404).json({ error: 'Offer not found' });
        }
    } catch (error: any) {
        logger.error(`Error updating offer: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

// Delete an offer by ID
router.delete('/:id', authorize([UserScope.Manager]), param('id').isUUID(), async (req, res) => {
    try {
        // Delete entries in the OfferSaleItemMap table first
        await OfferSaleItemMap.destroy({ where: { offerId: req?.params?.id } });

        const deleted = await DBOffer.destroy({
            where: { id: req?.params?.id },
        });
        if (deleted) {
            logger.info(`Offer deleted with ID: ${req?.params?.id}`);
            res.status(204).send();
        } else {
            res.status(404).json({ error: 'Offer not found' });
        }
    } catch (error: any) {
        logger.error(`Error deleting offer: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
});

export default router;
