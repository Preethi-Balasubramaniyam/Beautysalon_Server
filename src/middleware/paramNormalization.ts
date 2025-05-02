import { Request, Response, NextFunction } from 'express';
import { PhoneNumberUtil, PhoneNumberFormat } from 'google-libphonenumber';


interface CustomRequest extends Request {
    body: {
        mobile?: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [key: string]: any;
    };
}

const phUtil: PhoneNumberUtil = PhoneNumberUtil.getInstance();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trimObjectValues = (obj: { [key: string]: any }) => {
    for (const key in obj) {
        if (typeof obj[key] === 'string') {
            obj[key] = obj[key].trim();
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
            trimObjectValues(obj[key]);
        }
    }
};

const normalizeParameters = (req: CustomRequest, res: Response, next: NextFunction): void => {
    // Normalize parameters
    trimObjectValues(req.body);
    trimObjectValues(req.query);

    if (req.body.mobile) {
        const parsedFromNumber = phUtil.format(phUtil.parse(req.body.mobile, 'IN'), PhoneNumberFormat.E164);
        req.body.mobile = parsedFromNumber;
    }
    if (req.query.mobile) {
        if (typeof req.query.mobile === 'string') {
            const parsedFromNumber = phUtil.format(phUtil.parse(req.query.mobile, 'IN'), PhoneNumberFormat.E164);
            req.query.mobile = parsedFromNumber;
        }
    }
    next();
};

export default normalizeParameters;