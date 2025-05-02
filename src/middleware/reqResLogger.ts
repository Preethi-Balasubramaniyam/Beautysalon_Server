import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import logger, { healthCheckLogger, accessErrorLogger } from '../common/logger';
import winston from 'winston';

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            requestId: string;
            logger: winston.Logger;
        }
    }
}

const reqestReponseLogger = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const requestId = uuidv4();
    
    // Use healthCheckLogger for root path, otherwise use regular logger
    const isRootPath = req.originalUrl === '/';
    req.logger = isRootPath 
        ? healthCheckLogger.child({ requestId, module: 'reqResLogger' })
        : logger.child({ requestId, module: 'reqResLogger' });
    
    req.requestId = requestId;
    const start = Date.now();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let responseBody: any;
    const originalSend = res.send;

    res.send = function (body) {
        responseBody = body;
        return originalSend.call(this, body);
    };  

    res.on('finish', () => {
        const duration = Date.now() - start;
        const logMessage = `ApplicationCall: ${req.method} ${req.protocol}://${req.get('host')}${req.originalUrl} => ${res.statusCode} ${res.statusMessage} | Request:  ${JSON.stringify(req.headers)} ${JSON.stringify(req.body)} | Response: ${responseBody} | Duration: ${duration}ms`;
        
        // Use accessErrorLogger for 404 responses
        if (res.statusCode === 404) {
            accessErrorLogger.child({ requestId, module: 'reqResLogger' }).info(logMessage);
        } else {
            req.logger.info(logMessage);
        }
    });

    next();
};

export default reqestReponseLogger;
