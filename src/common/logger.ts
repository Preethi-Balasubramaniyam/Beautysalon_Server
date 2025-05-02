import { createLogger, format, transports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import fs from 'fs';
import path from 'path';
import config from 'config';
import os from 'os';
import { Writable } from 'stream';
class MyNullWritable extends Writable {
  _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    // Do nothing with the chunk
    callback();
  }
}

// Ensure log directory exists

let logDirectory = config.has('logDir') ? config.get<string>('logDir') : './logs';

try {
    if (!fs.existsSync(logDirectory)) {
        fs.mkdirSync(logDirectory, { recursive: true });
    }
} catch (error) {
    console.error(`Failed to create log directory at ${logDirectory}, using current directory instead.`, error);
    logDirectory = path.resolve('./logs');
    if (!fs.existsSync(logDirectory)) {
        fs.mkdirSync(logDirectory, { recursive: true });
    }
}

// Add request ID and socket ID to log format
const addIdentifiers = format((info) => {
    info.requestId = info.requestId || "-";
    info.socketId = info.socketId || "-";
    return info;
});

const logger = createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: format.combine(
        addIdentifiers(),
        format.timestamp(),
        format.splat(),
        format.json(),
        format.printf(({ timestamp, level, message, requestId, socketId }) => {
            return `${timestamp} ${socketId !== '-' ? `[${socketId}]` : ''} ${requestId !== '-' ? `[${requestId}]` : ''} [${process.pid}] [${os.hostname()}] ${level}: ${message}`;
        })
    ),
});

if (process.env.NODE_ENV === 'test') {
    logger.add(new transports.Stream({
       //stream: new MyNullWritable()
       stream: process.stdout
    }));
} else {
    logger.add(new DailyRotateFile({
        filename: path.join(logDirectory, `app-%DATE%.log`),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d'
    }));
}


export const queueLogger = createLogger({
    level: 'info',
    format: format.combine(
        addIdentifiers(),
        format.timestamp(),
        format.splat(),
        format.json(),
        format.printf(({ timestamp, level, message, requestId, socketId }) => {
            return `${timestamp} [${requestId}] [${socketId}] [${process.pid}] [${os.hostname()}] ${level}: ${message}`;
        })
    ),
});

if (process.env.NODE_ENV === 'test') {
    queueLogger.add(new transports.Stream({
        stream: new MyNullWritable()
    }));
} else {

    queueLogger.add(new DailyRotateFile({
        filename: path.join(logDirectory, `queue-%DATE%.log`),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d'
    }));
}

// Health check logger for root route requests
export const healthCheckLogger = createLogger({
    level: 'info',
    format: format.combine(
        addIdentifiers(),
        format.timestamp(),
        format.splat(),
        format.json(),
        format.printf(({ timestamp, level, message, requestId, socketId }) => {
            return `${timestamp} [${requestId}] [${socketId}] [${process.pid}] [${os.hostname()}] ${level}: ${message}`;
        })
    ),
});

if (process.env.NODE_ENV === 'test') {
    healthCheckLogger.add(new transports.Stream({
        stream: new MyNullWritable()
    }));
} else {
    healthCheckLogger.add(new DailyRotateFile({
        filename: path.join(logDirectory, `health-check-%DATE%.log`),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d'
    }));
}

// 404 error logger for not found responses
export const accessErrorLogger = createLogger({
    level: 'info',
    format: format.combine(
        addIdentifiers(),
        format.timestamp(),
        format.splat(),
        format.json(),
        format.printf(({ timestamp, level, message, requestId, socketId }) => {
            return `${timestamp} [${requestId}] [${socketId}] [${process.pid}] [${os.hostname()}] ${level}: ${message}`;
        })
    ),
});

if (process.env.NODE_ENV === 'test') {
    accessErrorLogger.add(new transports.Stream({
        stream: new MyNullWritable()
    }));
} else {
    accessErrorLogger.add(new DailyRotateFile({
        filename: path.join(logDirectory, `access_errors-%DATE%.log`),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d'
    }));
}

export default logger;
