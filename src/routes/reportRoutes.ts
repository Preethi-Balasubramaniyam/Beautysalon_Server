import { Router, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { body, validationResult, query } from 'express-validator';
import { authenticateToken } from '../middleware/authenticateToken';
import { authorize } from '../middleware/authorize';
import { UserScope } from '../types/userTypes';
import logger from '../common/logger';
import sequelize from '../models/database';
import { QueryTypes } from 'sequelize'; 
import ReportModel from '../models/report'; // Assuming you have the Report model set up as mentioned
// import { ReportConfig } from '../types/reportTypes';

const router = Router();

// Validation for creating a new report
const createReportValidation = [
  body('orgId').notEmpty().withMessage('Organization ID is required').isUUID().withMessage('Invalid Organization ID'),
  body('name').notEmpty().withMessage('Report name is required').isString().withMessage('Report name must be a string'),
  body('config').notEmpty().withMessage('Report configuration is required').isObject().withMessage('Config must be an object'),
  body('pinned').optional().isBoolean().withMessage('Pinned must be a boolean'),
];

// Route to create a report
router.post(
  '/',
  authenticateToken,
  authorize([UserScope.Admin, UserScope.Manager]),
  createReportValidation,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Validation errors', { errors: errors.array() });
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const { orgId, name, config, pinned } = req.body;
      const newReport = await ReportModel.create({
        orgId,
        name,
        config,
        pinned: pinned || false,
        createdBy: req.user.id,
        updatedBy: req.user.id,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      res.status(201).json({ report: newReport });
    } catch (error) {
      logger.error('Error creating report:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

// Validation for getting reports
const getReportsValidation = [
  query('orgId').optional().isUUID().withMessage('Invalid Organization ID'),
  query('pinned').optional().isBoolean().withMessage('Pinned must be a boolean'),
];

// Route to get all reports or filter by orgId and pinned
router.get(
  '/',
  authenticateToken,
  authorize([UserScope.Admin, UserScope.Manager]),
  getReportsValidation,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Validation errors', { errors: errors.array() });
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const reports = await ReportModel.findAll({
        where: { orgId: String(req.user.orgId)},
      });

      res.status(200).json({ reports });
    } catch (error) {
      logger.error('Error fetching reports:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

// Validation for updating a report
const updateReportValidation = [
  body('name').optional().isString().withMessage('Report name must be a string'),
  body('config').optional().isObject().withMessage('Config must be an object'),
  body('pinned').optional().isBoolean().withMessage('Pinned must be a boolean'),
];

// Route to update a report
router.patch(
  '/:id',
  authenticateToken,
  authorize([UserScope.Admin, UserScope.Manager]),
  updateReportValidation,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Validation errors', { errors: errors.array() });
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const { id } = req.params;
      const { name, config, pinned } = req.body;

      const report = await ReportModel.findByPk(id);
      if (!report) {
        res.status(404).json({ error: 'Report not found' });
        return;
      }

      if (report.orgId !== req.user.orgId) {
        res.status(403).json({ error: 'Not authorized to update this report' });
        return;
      }

      const updatedReport = await report.update({
        name,
        config,
        pinned,
        updatedBy: req.user.id,
      });

      res.status(200).json({ report: updatedReport });
    } catch (error) {
      logger.error('Error updating report:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

router.get(
    '/:id',
    authenticateToken,
    authorize([UserScope.Admin, UserScope.Manager]),
    async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
      try {
        const { id } = req.params;
  
        // Fetch the report by ID
        const report = await ReportModel.findByPk(id);
  
        if (!report) {
          res.status(404).json({ error: 'Report not found' });
          return;
        }
  
        // Extract the raw query from the report's config field
        const rawQuery = report.config.rawQuery;
  
        if (!rawQuery) {
          res.status(400).json({ error: 'No raw query found in the report configuration' });
          return;
        }
        
        console.log(rawQuery);
        const result = await sequelize.query(rawQuery, {
          type: QueryTypes.SELECT, // Specify the query type for SELECT
        });
  
        console.log('Query result:', result);
  
        // Return the result of the query
        res.status(200).json({ result });
      } catch (error) {
        logger.error('Error fetching report:', error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    }
  );

// Route to delete a report
router.delete(
  '/:id',
  authenticateToken,
  authorize([UserScope.Admin]),
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    try {
      const { id } = req.params;

      const report = await ReportModel.findByPk(id);
      if (!report) {
        res.status(404).json({ error: 'Report not found' });
        return;
      }

      await report.destroy();

      res.status(200).json({ message: 'Report deleted successfully' });
    } catch (error) {
      logger.error('Error deleting report:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

export default router;
