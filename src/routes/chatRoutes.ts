import express from 'express';
import { authorize } from '../middleware/authorize';
import { UserScope } from '../types/userTypes';
import { Op } from 'sequelize';
import Message from '../models/message';
import { Status, Channel, Endpoint as IEndpoint } from '../types/commTypes';
import { MessageServicesManager } from '../services/messaging/messageServiceManager';
import Endpoint from '../models/endpoint';

const router = express();

router.get('/orgendpoints', authorize([UserScope.ReadOnlyUser]), async (req, res) => {
    req.logger.info('Fetching chat endpoints from config');
    try {
        const page = parseInt(req.query.page as string) || 1;
        const pageSize = parseInt(req.query.limit as string) || 10;
        const offset = (page - 1) * pageSize;
        const channel = req.query.channel as Channel | undefined;

        // Get all endpoints for the organization
        const messageServicesManager = MessageServicesManager.getInstance();
        const messageProcessor = await messageServicesManager.getMessageProcessor(req.user.orgId);
        if (!messageProcessor) {
            res.status(200).json({ 
                endpoints: [],
                page,
                pageSize,
                totalItems: 0,
                totalPages: 0
            });
            return;
        }
        const allEndpoints = await messageProcessor.getAllOrgEndpoints();
        // Filter by channel if provided
        const filteredEndpoints = channel 
            ? allEndpoints.filter(endpoint => endpoint.channel === channel)
            : allEndpoints;

        if (filteredEndpoints.length === 0) {
            res.status(200).json({ 
                endpoints: [],
                page,
                pageSize,
                totalItems: 0,
                totalPages: 0
            });
            return;
        }

        // Get statistics for each endpoint
        const endpointStats = await Promise.all(filteredEndpoints.slice(offset, offset + pageSize).map(async (endpoint) => {
            const unreadMessages = await Message.count({
                where: {
                    toId: endpoint.id,
                    status: Status.delivered,
                }
            });

            const uniqueFromEndpoints = await Message.count({
                where: {
                    toId: endpoint.id,
                    status: Status.delivered,
                },
                distinct: true,
                col: 'fromId'
            });

            return { endpoint, unreadMessages, uniqueFromEndpoints };
        }));

        res.status(200).json({ 
            endpoints: endpointStats,
            page,
            pageSize,
            totalItems: filteredEndpoints.length,
            totalPages: Math.ceil(filteredEndpoints.length / pageSize)
        });
    } catch (error) {
        req.logger.error('Error fetching chat endpoints: %o', error);
        res.status(500).json({ error });
    }
});

router.get('/activecontacts', authorize([UserScope.ReadOnlyUser]), async (req, res) => {
    const { orgEndpointId, endpointId, filter } = req.query as { orgEndpointId?: string, endpointId?: string, filter: string };
    const channel = req.query.channel as Channel | undefined;
    
    req.logger.info('Fetching active chat endpoints for the last 7 days %o', { orgEndpointId, endpointId, filter, channel });

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    try {
        // Get organization endpoints
        let orgEndpoints: IEndpoint[] = [];
        
        // If orgEndpointId is provided, just get that specific endpoint
        if (orgEndpointId) {
            const orgEndpoint = await Endpoint.findByPk(orgEndpointId);
            if (!orgEndpoint) {
                res.status(404).json({ error: 'Organization endpoint not found' });
                return;
            }
            orgEndpoints = [Endpoint.mapDBModel2Interface(orgEndpoint)];
        } else {
            // Otherwise get all org endpoints
            const messageServicesManager = MessageServicesManager.getInstance();
            const messageProcessor = await messageServicesManager.getMessageProcessor(req.user.orgId);
            if (!messageProcessor) {
                res.status(200).json({ 
                    data: [],
                    page: 1,
                    pageSize: 10,
                    totalItems: 0,
                    totalPages: 0
                });
                return;
            }
            orgEndpoints = await messageProcessor.getAllOrgEndpoints();
            if (channel) {
                orgEndpoints = orgEndpoints.filter(endpoint => endpoint.channel === channel);
            }
        }
        
        if (orgEndpoints.length === 0) {
            res.status(200).json({ 
                data: [],
                page: 1,
                pageSize: 10,
                totalItems: 0,
                totalPages: 0
            });
            return;
        }
        
        // Get all orgEndpoint IDs
        const orgEndpointIds = orgEndpoints.map(e => e.id);
        
        // Build where condition based on provided filters
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let whereCondition: any = {
            timestamp: {
                [Op.gte]: sevenDaysAgo
            }
        };
        
        // Add channel filter if provided
        if (channel) {
            whereCondition.channel = channel;
        }
        
        // If specific endpointId is provided, filter by that
        if (endpointId) {
            whereCondition = {
                ...whereCondition,
                [Op.or]: [
                    { 
                        fromId: { [Op.in]: orgEndpointIds },
                        toId: endpointId 
                    },
                    { 
                        fromId: endpointId,
                        toId: { [Op.in]: orgEndpointIds } 
                    }
                ]
            };
        } else {
            // Otherwise, get all messages where either sender or receiver is an org endpoint
            whereCondition = {
                ...whereCondition,
                [Op.or]: [
                    { fromId: { [Op.in]: orgEndpointIds } },
                    { toId: { [Op.in]: orgEndpointIds } }
                ]
            };
        }
        
        // Add text filter if provided
        if (filter) {
            whereCondition = {
                ...whereCondition,
                [Op.or]: [
                    { '$fromEndpoint.externalId$': { [Op.like]: `%${filter}%` } },
                    { '$fromEndpoint.displayName$': { [Op.like]: `%${filter}%` } },
                    { '$toEndpoint.externalId$': { [Op.like]: `%${filter}%` } },
                    { '$toEndpoint.displayName$': { [Op.like]: `%${filter}%` } }
                ]
            };
        }

        // Find all active conversations
        const activeChats = await Message.findAll({
            where: whereCondition,
            include: [
                {
                    model: Endpoint,
                    as: 'fromEndpoint'
                },
                {
                    model: Endpoint,
                    as: 'toEndpoint'
                }
            ],
            attributes: ['fromId', 'toId', 'channel'],
            group: ['Message.fromId', 'Message.toId', 'Message.channel'],
            order: [
                ['timestamp', 'DESC']
            ]
        });
        
        // Create a mapping of conversations between org endpoints and other endpoints
        const conversationMap = new Map();
        
        for (const chat of activeChats) {
            const fromId = chat.fromId;
            const toId = chat.toId;
            const chatChannel = chat.channel;
            
            // Determine which is the org endpoint and which is the other endpoint
            let orgEndpointId = null;
            let otherEndpointId = null;
            
            if (orgEndpointIds.includes(fromId)) {
                orgEndpointId = fromId;
                otherEndpointId = toId;
            } else {
                orgEndpointId = toId;
                otherEndpointId = fromId;
            }
            
            // Skip if other endpoint is also an org endpoint (internal communication)
            if (orgEndpointIds.includes(otherEndpointId) && !endpointId) {
                continue;
            }
            
            // Create a unique key for this conversation pair (include channel to differentiate)
            const conversationKey = `${orgEndpointId}-${otherEndpointId}-${chatChannel}`;
            
            // Only add if not already in the map
            if (!conversationMap.has(conversationKey)) {
                conversationMap.set(conversationKey, {
                    orgEndpointId,
                    otherEndpointId,
                    channel: chatChannel
                });
            }
        }
        
        // Convert the map to an array
        const conversations = Array.from(conversationMap.values());
        
        // Pagination
        const page = parseInt(req.query.page as string) || 1;
        const pageSize = parseInt(req.query.pageSize as string) || 10;
        const offset = (page - 1) * pageSize;
        const paginatedConversations = conversations.slice(offset, offset + pageSize);
        
        // Retrieve detailed information for each paginated conversation
        const data = await Promise.all(paginatedConversations.map(async (convo) => {
            const { orgEndpointId, otherEndpointId, channel: convoChannel } = convo;
            
            // Get the endpoints
            const orgEndpoint = await Endpoint.findByPk(orgEndpointId);
            const otherEndpoint = await Endpoint.findByPk(otherEndpointId);
            
            if (!orgEndpoint || !otherEndpoint) {
                return null;
            }
            
            // Count unread messages
            const unreadMessageCount = await Message.count({
                where: {
                    fromId: otherEndpointId,
                    toId: orgEndpointId,
                    status: Status.delivered,
                    ...(convoChannel && { channel: convoChannel })
                }
            });
            
            // Get the latest message
            const lastMessage = await Message.findOne({
                where: {
                    [Op.or]: [
                        { fromId: orgEndpointId, toId: otherEndpointId },
                        { fromId: otherEndpointId, toId: orgEndpointId }
                    ],
                    ...(convoChannel && { channel: convoChannel })
                },
                order: [['timestamp', 'DESC']]
            });
            
            return {
                orgEndpoint: Endpoint.mapDBModel2Interface(orgEndpoint),
                otherEndpoint: Endpoint.mapDBModel2Interface(otherEndpoint),
                unreadMessageCount,
                lastMessage: lastMessage ? (await Message.mapDBModel2Interface(lastMessage)) : null,
                channel: convoChannel
            };
        }));
        
        // Filter out nulls and send response
        res.status(200).json({
            data: data.filter(Boolean),
            page,
            pageSize,
            totalItems: conversations.length,
            totalPages: Math.ceil(conversations.length / pageSize)
        });
    } catch (error) {
        req.logger.error('Error fetching active chat endpoints: %o', error);
        res.status(500).json({ error });
    }
});

export default router;
