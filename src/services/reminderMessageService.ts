import { Channel, MessageType, Status, MessageContentType, IMessageInput } from '../types/commTypes';
import Message from '../models/message';
import Customer from '../models/customer';
import logger from '../common/logger';
import { User } from '../types/userTypes';
import { MessageServicesManager } from './messaging/messageServiceManager';

export async function createOrUpdateReminderMessage(params: {
    eventId: string,
    eventType: string,
    customerId: string,
    startTime: Date,
    reminderOffset: number,
    user: User,
    existingMessageId?: string
}) {
    const { eventId, eventType, customerId, startTime, reminderOffset, user, existingMessageId } = params;
    
    try {
        const customer = await Customer.findByPk(customerId);
        if (!customer?.mobile) {
            logger.warn('Cannot create reminder - no mobile number:', { customerId });
            return null;
        }

        const customerEndpoint = await customer.getWhatsappEndpoint();

        const reminderTime = new Date(startTime.getTime() - (reminderOffset * 60 * 60 * 1000));

        const messageProcessor =  await MessageServicesManager.getInstance().getMessageProcessor(user.orgId);

        const orgEndpoints = await messageProcessor.getAllOrgEndpoints();

        if (!orgEndpoints) {
            logger.warn('No message processor or whatsapp service found for org: %o', { orgId: user.orgId });
            return null;
        }

        const whatsappEndpoint = orgEndpoints.find((endpoint) => endpoint.channel === Channel.whatsapp);

        if (!whatsappEndpoint) {
            logger.warn('No WhatsApp endpoints configured');
            return null;
        }

        // If updating existing message
        if (existingMessageId) {
            const existingMessage = await Message.findByPk(existingMessageId);
            if (existingMessage && existingMessage.status === Status.queued) {
                const updatedMessageInput = await Message.mapDBModel2Interface(existingMessage);
                updatedMessageInput.timestamp = reminderTime;
                updatedMessageInput.externalMetaData = {
                    ...updatedMessageInput.externalMetaData,
                    eventId,
                    eventType,
                    appointmentTime: startTime
                };
                
                return await messageProcessor.updateMessage(updatedMessageInput, user);
            }
        }

        // Create new message input
        const messageInput: IMessageInput = {
            channel: Channel.whatsapp,
            fromId: whatsappEndpoint.id,
            senderId: whatsappEndpoint.id, //TODO: Update this to the actual initiator id which is user and API
            toId: customerEndpoint.id,
            content: {
                type: MessageContentType.template,
                templateName: 'appointment_reminder',
                templateParams: {
                    customerName: customer.name,
                    customerMobile: customer.mobile,
                    appointmentTime: startTime.toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
                }
            },
            timestamp: reminderTime,
            type: MessageType.support,
            metaData: { noOfRetriesLeft: 3, eventId, eventType },
            status: Status.queued
        };

        // Use MessageProcessor to handle the message creation
        return await messageProcessor.handleMessage(messageInput, user);

    } catch (error) {
        logger.error('Failed to handle reminder message:', error);
        return null;
    }
}
