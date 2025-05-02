import express from 'express';
import bcrypt from 'bcryptjs';
import { body, validationResult, query } from 'express-validator';
import DBUser from '../models/user';
import { UserRole, RegisterInput, RegisterOutput, UpdateUserInput, UpdateUserOutput, User, UserScope } from '../types/userTypes';
import { Op, UniqueConstraintError } from 'sequelize';
import { authorize } from '../middleware/authorize';
import normalizeParameters from '../middleware/paramNormalization';

const router = express.Router();

const roleScopes = {
    [UserRole.Admin]: [UserScope.Admin, UserScope.Manager, UserScope.ReadOnlyUser, UserScope.ServiceProvider],
    [UserRole.Manager]: [UserScope.Manager, UserScope.ReadOnlyUser, UserScope.ServiceProvider],
    [UserRole.ServiceProvider]: [UserScope.ServiceProvider, UserScope.ReadOnlyUser],
    [UserRole.ReadOnlyUser]: [UserScope.ReadOnlyUser]
};

const handleValidationErrors = (req: express.Request, res: express.Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return false;
    }
    return true;
};

router.post('/', [
    authorize([UserScope.Admin]),
    normalizeParameters,
    body('username').notEmpty().withMessage('Username is required'),
    body('password').notEmpty().isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
    body('role').notEmpty().withMessage('Role is required'),
    body('email').isEmail().withMessage('Invalid email address'),
    body('mobile').notEmpty().isMobilePhone('any').withMessage('Valid Mobile is required'),
    body('name').isLength({ min: 3 }).withMessage('Name must be at least 3 characters long'),
    body('serviceProviderId').optional().isString().withMessage('Service Provider ID must be a string'),
], async (req: express.Request, res: express.Response): Promise<void> => {
    req.logger.info('Registering a new user', { body: req.body });
    if (!handleValidationErrors(req, res)) return;

    try {
        const { username, password, role }: RegisterInput = req.body;
        const existingUser = await DBUser.findOne({ where: { username } });

        if (existingUser) {
            res.status(400).json({ error: 'User already exists' });
            return;
        }

        const scope = roleScopes[role];
        if (!scope) {
            res.status(400).json({ error: 'Invalid role' });
            return;
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const createdBy = req.user.username;
        const userInput = DBUser.toDBCreate(req.body, createdBy, hashedPassword, req.user.orgId);
        userInput.orgId = req.user.orgId;
        const newUser = await DBUser.create(userInput);
        const userOutput: User = DBUser.fromDBModel(newUser);
        res.status(201).json({ message: 'User registered successfully', user: userOutput } as RegisterOutput);
        req.logger.info('User registered successfully', { username });
    } catch (error) {
        req.logger.error('Error registering user', { error });
        if (error instanceof UniqueConstraintError) {
            res.status(400).json({ error: 'Username or email already exists' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

router.put('/:id', [
    authorize([UserScope.Admin]),
    normalizeParameters,
    body('role').optional().notEmpty().withMessage('Role is required'),
    body('email').optional().isEmail().withMessage('Invalid email address'),
    body('mobile').optional().notEmpty().isMobilePhone('any').withMessage('Valid Mobile is required'),
    body('name').optional().isLength({ min: 3 }).withMessage('Name must be at least 3 characters long'),
    body('password').optional().isLength({ min: 6 }).withMessage('Password must be at least 6 characters long'),
    body('serviceProviderId').optional().isString().withMessage('Service Provider ID must be a string'),
], async (req: express.Request, res: express.Response) => {
    req.logger.info('Updating user', { params: req.params, body: req.body });
    if (!handleValidationErrors(req, res)) return;


    try {
        const { id } = req.params;
        const { role, email, mobile, name, password, serviceProviderId }: UpdateUserInput = req.body;
        const user = await DBUser.findOne({ where: { id } });

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            return;
        }

        if (role) {
            const scope = roleScopes[role];
            if (!scope) {
                res.status(400).json({ error: 'Invalid role' });
                return;
            }
            user.role = role;
            user.scope = scope;
        }

        if (password) {
            user.password = await bcrypt.hash(password, 10);
        }
        if (email) {
            user.email = email;
        }
        if (mobile) {
            user.mobile = mobile;
        }
        if (name) {
            user.name = name;
        }
        if (serviceProviderId !== undefined) {
            user.serviceProviderId = serviceProviderId;
        }
        user.updatedBy = req.user.username;
        await user.save();
        const userOutput: User = DBUser.fromDBModel(user);
        res.status(200).json({ message: 'User updated successfully', user: userOutput } as UpdateUserOutput);
        req.logger.info('User updated successfully', { id });
    } catch (error) {
        req.logger.error('Error updating user', { error });
        if (error instanceof UniqueConstraintError) {
            res.status(400).json({ error: 'Username or email already exists' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

router.get('/:id', authorize([UserScope.ReadOnlyUser]), async (req: express.Request, res: express.Response) => {
    try {
        req.logger.info('Fetching user by ID', { params: req.params });
        const { id } = req.params;
        const user = await DBUser.findOne({ where: { id, orgId: req.user.orgId } }); // Filter by orgId

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            req.logger.warn('User not found', { id });
            return;
        }

        const userOutput: User = DBUser.fromDBModel(user);
        res.status(200).json({ user: userOutput });
        req.logger.info('User fetched successfully', { id });
    } catch (error) {
        req.logger.error('Error fetching user by ID', { error });
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/', authorize([UserScope.Admin]), [
    query('username').optional().isString().withMessage('Username must be a string'),
    query('mobile').optional().isLength({ min: 10, max: 10 }).withMessage('Invalid mobile number'),
    query('email').optional().isEmail().withMessage('Invalid email address'),
    query('role').optional().isIn(Object.values(UserRole)).withMessage('Invalid role'),
    query('sortBy').optional().isIn(['username', 'email', 'mobile', 'name', 'role']).withMessage('Invalid sort field'),
    query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Invalid sort order'),
    query('filter').optional().isString().withMessage('Filter must be a string'),
    query('serviceProviderId').optional().isString().withMessage('Service Provider ID must be a string'),
    query('page').optional().isInt({ min: 1 }).default(1),
    query('pageSize').optional().isInt({ min: 1 }).default(10),
], async (req: express.Request, res: express.Response) => {
    try {
        req.logger.info('Fetching users with filters', { query: req.query });
        if (!handleValidationErrors(req, res)) return;

        const { username, mobile, email, role, sortBy, sortOrder, filter, serviceProviderId, page = '1', pageSize = '10' } = req.query as {
            username?: string;
            mobile?: string;
            email?: string;
            role?: string;
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
            filter?: string;
            serviceProviderId?: string;
            page: string;
            pageSize: string;
        };

        //eslint-disable-next-line @typescript-eslint/no-explicit-any
        const whereClause: any = {
            orgId: req.user.orgId
        };
        if (username) whereClause.username = username;
        if (mobile) whereClause.mobile = mobile;
        if (email) whereClause.email = email;
        if (role) whereClause.role = role;

        if (filter) {
            whereClause[Op.or] = [
                { username: { [Op.like]: `%${filter}%` } },
                { email: { [Op.like]: `%${filter}%` } },
                { mobile: { [Op.like]: `%${filter}%` } },
                { name: { [Op.like]: `%${filter}%` } },
                { role: { [Op.like]: `%${filter}%` } }
            ];
        }

        if (serviceProviderId) whereClause.serviceProviderId = serviceProviderId;

        const pageNumber = parseInt(page);
        const size = parseInt(pageSize);
        const offset = (pageNumber - 1) * size;

        const { count, rows: users } = await DBUser.findAndCountAll({
            where: whereClause,
            order: sortBy ? [[sortBy, sortOrder?.toUpperCase() || 'ASC']] : undefined,
            limit: size,
            offset: offset
        });

        const userOutputs: User[] = users.map(user => (DBUser.fromDBModel(user)));

        res.status(200).json({
            totalItems: count,
            totalPages: Math.ceil(count / size),
            currentPage: pageNumber,
            pageSize: size,
            users: userOutputs
        });
        req.logger.info('Users fetched successfully', { count: userOutputs.length });
    } catch (error) {
        req.logger.error('Error fetching users', { error });
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.delete('/:id', authorize([UserScope.Admin]), async (req: express.Request, res: express.Response) => {
    try {
        req.logger.info('Deleting user', { params: req.params });
        const { id } = req.params;
        const user = await DBUser.findOne({ where: { id, orgId: req.user.orgId } });

        if (!user) {
            res.status(404).json({ error: 'User not found' });
            req.logger.warn('User not found', { id });
            return;
        }

        if (req.user.username === user.username) {
            res.status(400).json({ error: 'You cannot delete your own account' });
            req.logger.warn('User attempted to delete their own account', { id });
            return;
        }

        await user.destroy();
        res.status(204).json({ message: 'User deleted successfully' });
        req.logger.info('User deleted successfully', { id });
    } catch (error) {
        req.logger.error('Error deleting user', { error });
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;