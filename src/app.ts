import express, { Request, Response, NextFunction } from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import customerRoutes from './routes/customerRoutes';
import branchRoutes from './routes/branchRoutes';
import saleItemRoutes from './routes/saleItemRoutes';
import offerRoutes from './routes/offerRoutes';
import serviceProviderRoutes from './routes/serviceProviderRoutes';
import reqResLogger from './middleware/reqResLogger';
import eventRoutes from './routes/eventRoutes';
import invoiceRoutes from './routes/invoiceRoutes';
import ledgerRoutes from './routes/ledgerRoutes';
import { authenticateToken } from './middleware/authenticateToken';
import messageRoutes from './routes/messageRoutes';
import orgRoutes from './routes/orgRoutes';
import categoryRoutes from './routes/saleItemCategoryRoutes';
import callRoutes from './routes/callRoutes';
import chatRoutes from './routes/chatRoutes';
import mediaRoutes from './routes/mediaRoutes';
import endpointRoutes from './routes/endpointRoutes';
import sequelize from './models/database';
import queueRoutes from './routes/queueRoutes';
import helmet from 'helmet';
import compression from 'compression';
import { config as dotenvConfig } from 'dotenv';
import logger from './common/logger';
import reportRoutes from './routes/reportRoutes'; 
import instagramRoutes from './routes/instagramRoutes';
import otpAuthRoutes from './routes/otpauthRoutes'; // Ensure casing matches the actual file name
// Load environment variables
dotenvConfig();

export const app = express();


// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use(reqResLogger);
app.use(helmet());
app.use(compression());

app.use('/oauth', authRoutes);
app.use('/otp', otpAuthRoutes); 
app.use('/users', authenticateToken, userRoutes);
app.use('/customers', authenticateToken, customerRoutes);
app.use('/branches', authenticateToken, branchRoutes);
app.use('/saleItems', authenticateToken, saleItemRoutes);
app.use('/offers', authenticateToken, offerRoutes);
app.use('/serviceProviders', authenticateToken, serviceProviderRoutes);
app.use('/events', authenticateToken, eventRoutes);
app.use('/invoices', authenticateToken, invoiceRoutes);
app.use('/ledgers', authenticateToken, ledgerRoutes);
app.use('/messages', authenticateToken, messageRoutes);
app.use('/org', authenticateToken, orgRoutes);
app.use('/saleItemCategories', authenticateToken, categoryRoutes);
app.use('/calls', authenticateToken, callRoutes);
app.use('/chats', authenticateToken, chatRoutes);
app.use('/media', authenticateToken, mediaRoutes);
app.use('/endpoints', authenticateToken, endpointRoutes);
app.use('/queue', authenticateToken, queueRoutes);
app.use('/reports', authenticateToken, reportRoutes); 
app.use('/instagram', instagramRoutes);

app.get('/', async (req: Request, res: Response) => {
    res.send('Hello World!');
});

app.get('/health', async (req: Request, res: Response) => {
    try {
        await sequelize.authenticate();
        res.send('OK');
    } catch (error) {
        logger.error('Database connection error:', error);
        res.status(500).send('Database connection error ' + error);
    }
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    logger.error('Error:', err);
    res.status(500).json({ error: 'Internal server error' });
    next();
});
