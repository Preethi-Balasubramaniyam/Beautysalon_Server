import { Router, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { body, validationResult } from 'express-validator';
import Org from '../models/org';
import OTP from '../models/otp';
import DBUser from '../models/user';
import { ExotelService } from '../services/exotelService';
import { ExotelServiceImpl } from '../services/exotelService';
import logger from '../common/logger';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import oauth from '../oauthServer';
import { Request as OAuthRequest, Response as OAuthResponse } from 'oauth2-server';

const router = Router();
const exotelService: ExotelService = new ExotelServiceImpl();

// Constants
const OTP_EXPIRY_TIME_MS = 5 * 60 * 1000; // 5 minutes
const OTP_RESEND_TIMEOUT_MS = 60 * 1000; // 1 minute
const MAX_RESEND_ATTEMPTS = 3;

// Validation rules
const otpValidation = [
    body('otp').notEmpty().withMessage('OTP is required').isString().withMessage('OTP must be a string'),
    body('mobile').notEmpty().withMessage('Mobile number is required').isString().withMessage('Mobile number must be a string'),
];

// Rate limiting middleware
const otpRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 requests
    message: { success: false, message: 'Too many OTP requests. Please try again later.' },
});

// Hash OTP before storing
async function hashOtp(otp: string): Promise<string> {
    console.log('OTP:',otp);
    const saltRounds = 10;
    return await bcrypt.hash(otp, saltRounds);
}

// Compare OTP during verification
async function verifyOtpHash(otp: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(otp, hash);
}

// Generate a new OTP
function generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

router.post('/send-otp', otpRateLimiter, otpValidation, async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const { mobile } = req.body;

    if (!mobile) {
        res.status(400).json({ success: false, message: 'Mobile number is required' });
        return;
    }

    try {
        const user = await DBUser.findOne({ where: { mobile } });
        if (!user) {
            res.status(404).json({ success: false, message: 'User not found with the provided mobile number' });
            return;
        }

        const orgConfig = await Org.getConfiguration(user.orgId);
        if (!orgConfig || !orgConfig.exotel) {
            res.status(400).json({ success: false, message: `Sending OTP not supported for this Org ${user.orgId}` });
            return;
        }

        const otpRecord = await OTP.findOne({ where: { mobile_number: mobile } });
        const now = new Date();

        if (otpRecord) {
            const timeSinceLastSent = now.getTime() - otpRecord.last_sent_time.getTime();
            if (timeSinceLastSent < OTP_RESEND_TIMEOUT_MS) {
                const waitTime = Math.ceil((OTP_RESEND_TIMEOUT_MS - timeSinceLastSent) / 1000);
                res.status(429).json({ success: false, message: `Please wait ${waitTime} seconds before requesting a new OTP` });
                return;
            }
            if (otpRecord.resend_count >= MAX_RESEND_ATTEMPTS) {
                res.status(429).json({ success: false, message: 'Maximum resend attempts reached. Please try again later.' });
                return;
            }
        }

        const expiryTime = new Date(Date.now() + OTP_EXPIRY_TIME_MS);

        await OTP.create({
            mobile_number: mobile,
            user_id: user.id,
            otp: await hashOtp(generateOtp()),
            expiry_time: expiryTime,
            attempt_count: 0,
            resend_count: otpRecord ? otpRecord.resend_count + 1 : 0,
            last_sent_time: now,
        });

        await exotelService.generateOtp(orgConfig.exotel, mobile);

        res.status(200).json({ success: true, message: otpRecord ? 'OTP resent successfully' : 'OTP sent successfully' });
    } catch (error) {
        logger.error('Error occurred while sending OTP:', error);
        res.status(503).json({ success: false, message: 'Internal Server Error' });
    }
});

router.post('/verify-otp', otpValidation, async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        res.status(400).json({ success: false, errors: errors.array() });
        return;
    }

    const { otp, mobile } = req.body;

    if (!mobile) {
        res.status(400).json({ success: false, message: 'Mobile number is required' });
        return;
    }

    try {
        const otpRecord = await OTP.findOne({ where: { mobile_number: mobile } });
        if (!otpRecord) {
            res.status(400).json({ success: false, message: 'OTP not found' });
            return;
        }

        if (otpRecord.expiry_time < new Date()) {
            res.status(400).json({ success: false, message: 'OTP expired' });
            return;
        }

        const isOtpValid = await verifyOtpHash(otp, otpRecord.otp);
      
        if (!isOtpValid) {
            await otpRecord.update({ attempt_count: otpRecord.attempt_count + 1 });
            res.status(400).json({ success: false, message: 'Invalid OTP' });
            return;
        }

        const user = await DBUser.findOne({ where: { id: otpRecord.user_id } });
        if (!user) {
            res.status(404).json({ success: false, message: 'User not found' });
            return;
        }


        // Destroy OTP record after successful verification

        // Generate OAuth token using the OTP as the password
        const clientCredentials = Buffer.from('CleopatraClient:NotABigSecret').toString('base64');
        const oauthRequest = new OAuthRequest({
            body: {
                username: user.username,
                password: otp, // Use the OTP directly as the password
                grant_type: 'password',
                client_id: 'CleopatraClient',
                client_secret: 'NotABigSecret',
            },
            headers: {
                ...req.headers,
                'content-type': 'application/x-www-form-urlencoded',
                Authorization: `Basic ${clientCredentials}`,
            },
            method: req.method,
            query: req.query,
        });
        const oauthResponse = new OAuthResponse(res);
        oauth.token(oauthRequest, oauthResponse)
            .then((token) => {
                const expiresIn = token.accessTokenExpiresAt
                    ? Math.floor((token.accessTokenExpiresAt.getTime() - Date.now()) / 1000)
                    : null;
                res.status(200).json({
                    success: true,
                    ...token,
                    access_token: token.accessToken,
                    refresh_token: token.refreshToken,
                    expires_in: expiresIn,
                    token_type: 'Bearer',
                    scope: token.scope,
                });
            })
            .catch((err) => {
                logger.error('Error issuing access token', { error: err });
                res.status(err.code || 500).json({ success: false, message: 'Error issuing access token', error: err });
            });
    } catch (error) {
        logger.error('Error during verification of OTP', { error });
        res.status(503).json({ success: false, message: 'Internal Server Error' });
    }
});

export default router;