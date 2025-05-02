import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import config from 'config';
import logger from '../common/logger'; // Import the logger
import { Logger } from 'winston';

let s3Client: S3Client;

const awsRegion = process.env.AWS_REGION || config.has('aws.region') ? config.get('aws.region') as string: 'us-west-2';
const awsS3BucketName = process.env.AWS_S3_BUCKET_NAME || config.has('aws.s3.bucketName') ? config.get('aws.s3.bucketName') as string: 'test-bucket';
const accessKeyId = process.env.AWS_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || '';
const sessionToken = process.env.AWS_SESSION_TOKEN || '';

if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'staging') {
    logger.info('Initializing S3 client for development environment');
    if (!accessKeyId || !secretAccessKey) {
        logger.error('AWS access key ID and secret access key are required for desktop. S3 Uploads wont work');
        console.error('AWS access key ID and secret access key are required for desktop. S3 Uploads wont work');
    } else {
        logger.info(`Initializing S3 client for development environment with access key ID ${accessKeyId} and secret access key ${secretAccessKey}`);
    }
    s3Client = new S3Client({
        region: awsRegion,
        credentials: {
            accessKeyId: accessKeyId,
            secretAccessKey: secretAccessKey,
            sessionToken: sessionToken,
        },
    });
} else {
    logger.info('Initializing S3 client for production/staging environment');
    s3Client = new S3Client({ region: awsRegion });
}

export const getPresignedUrl = async (reqLogger: Logger, fileName: string, fileType: string, orgId: string, customerId?: string, serviceProviderId?: string): Promise<string> => {
    reqLogger.info(`Generating presigned URL for file: ${fileName}, orgId: ${orgId}`);
    const command = new PutObjectCommand({
        Bucket: awsS3BucketName,
        Key: `${orgId}/${fileName}`, // Ensure files are in a separate directory for each orgId
        ContentType: fileType,
        Metadata: {
            customerId: customerId || '',
            serviceProviderId: serviceProviderId || '',
        },
    });

    try {
        const url = await getSignedUrl(s3Client, command, { expiresIn: 900 }); // URL expiration time in seconds
        reqLogger.info(`Presigned URL generated successfully for file: ${fileName}`);
        return url;
    } catch (err) {
        if (err instanceof Error) {
            reqLogger.error(`Error generating presigned URL: ${err.message}`);
            throw new Error(`Error generating presigned URL: ${err.message}`);
        } else {
            reqLogger.error('Error generating presigned URL');
            throw new Error('Error generating presigned URL');
        }
    }
};

export const deleteS3Object = async (reqLogger: Logger, url: string, orgId: string): Promise<void> => {
    reqLogger.info(`Deleting S3 object for file: ${url}, orgId: ${orgId}`);
    const command = new DeleteObjectCommand({
        Bucket: awsS3BucketName,
        Key: url,
    });

    try {
        await s3Client.send(command);
        reqLogger.info(`S3 object deleted successfully for file: ${url}`);
    } catch (err) {
        if (err instanceof Error) {
            reqLogger.error(`Error deleting S3 object: ${err.message}`);
            throw new Error(`Error deleting S3 object: ${err.message}`);
        } else {
            reqLogger.error('Error deleting S3 object');
            throw new Error('Error deleting S3 object');
        }
    }
};

export const upload2S3 = async (
    fileContent: Buffer | Uint8Array | Blob | string,
    key: string,
    contentType: string,
    expires: number = Date.now() + 60 * 60 * 1000 // Default expiration time: 60 minutes
): Promise<string> => {
    const command = new PutObjectCommand({
        Bucket: awsS3BucketName,
        Key: key,
        Body: fileContent,
        ContentType: contentType,
        Expires: new Date(expires) // Use the provided expiration time
    });

    try {
        await s3Client.send(command);
        const s3Url = `https://${awsS3BucketName}.s3.${awsRegion}.amazonaws.com/${key}`;
        logger.info(`File uploaded successfully to S3: ${s3Url}`);
        return s3Url;
    } catch (err) {
        if (err instanceof Error) {
            logger.error(`Error uploading file to S3: ${err.message}`);
            throw new Error(`Error uploading file to S3: ${err.message}`);
        } else {
            logger.error('Error uploading file to S3');
            throw new Error('Error uploading file to S3');
        }
    }
};
