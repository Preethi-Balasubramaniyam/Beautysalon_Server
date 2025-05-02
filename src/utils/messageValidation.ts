import { IMessageInput, MessageType, MessageContentType } from '../types/commTypes';
import EndpointModel from '../models/endpoint';
import logger from '../common/logger';

export interface ValidationError {
    errors: string[];
}

export class MessageValidator {
    private orgId: string;

    constructor(orgId: string) {
        this.orgId = orgId;
    }

    public async validateMessage(messageData: IMessageInput): Promise<ValidationError | null> {
        const errors: string[] = [];

        if (!messageData.fromId) {
            logger.error('From ID is required');
            errors.push('From ID is required');
        }

        // Validate to endpoint ID
        if (!messageData.toId || !messageData.toId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
            logger.error('Invalid to endpoint ID format');
            errors.push('Invalid to endpoint ID format');
        }

        // Validate message type
        if (!messageData.type || !Object.values(MessageType).includes(messageData.type)) {
            logger.error('Invalid message type');
            errors.push('Invalid message type');
        }

        // Validate content
        if (!messageData.content || typeof messageData.content !== 'object') {
            logger.error('Content is required and must be an object');
            errors.push('Content is required and must be an object');
        }

        if (messageData.content) {
            // Validate content type
            if (!messageData.content.type || !Object.values(MessageContentType).includes(messageData.content.type)) {
                logger.error('Invalid content type');
                errors.push('Invalid content type');
            }

            // Validate text content
            if (messageData.content.type === MessageContentType.text && !messageData.content.text) {
                logger.error('Text content is required for text messages');
                errors.push('Text content is required for text messages');
            }

            // Validate template content
            if (messageData.content.type === MessageContentType.template && (!messageData.content.templateName || !messageData.content.templateParams)) {
                logger.error('Template name and parameters are required for template messages');
                errors.push('Template name and parameters are required for template messages');
            }
        }

        // Validate meta data
        if (messageData.metaData && typeof messageData.metaData !== 'object') {
            logger.error('Meta data must be an object');
            errors.push('Meta data must be an object');
        }

        if (messageData.fromId && messageData.toId) {
            // Validate endpoints and channels
            const [toEndpoint, fromEndpoint] = await Promise.all([
                EndpointModel.findByPk(messageData.toId),
                EndpointModel.findByPk(messageData.fromId)
            ]);

            if (!toEndpoint) {
                logger.error('To endpoint not found');
                errors.push('To endpoint not found');
            }

            if (!fromEndpoint) {
                logger.error('From endpoint not found');
                errors.push('From endpoint not found');
            }

            if (toEndpoint && toEndpoint.orgId !== this.orgId) {
                logger.error('To endpoint does not belong to this organization');
                errors.push('To endpoint does not belong to this organization');
            }

            if (fromEndpoint && fromEndpoint.orgId !== this.orgId) {
                logger.error('From endpoint does not belong to this organization');
                errors.push('From endpoint does not belong to this organization');
            }

            if (fromEndpoint && toEndpoint && toEndpoint.channel !== fromEndpoint.channel) {
                logger.error('From and to endpoints must be of the same channel');
                errors.push('From and to endpoints must be of the same channel');
            }
        }

        return errors.length > 0 ? { errors } : null;
    }
} 