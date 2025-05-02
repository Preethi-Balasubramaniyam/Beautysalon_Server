export enum Status {
    queued = 'queued',
    sent = 'sent',
    read = 'read',
    delivered = 'delivered',
    failed = 'failed',
    cancelled = 'cancelled'
}

export enum MessageType {
    marketing = 'marketing',
    support = 'support'
}

export enum Channel {
    whatsapp = 'whatsapp',
    sms = 'sms',
    call = 'call',
    app = 'app',
    email = 'email',
    instagram = 'instagram',
    facebook = 'facebook',
    twitter = 'twitter',
    linkedin = 'linkedin',
    youtube = 'youtube',
    api = 'api'
}

export interface Endpoint {
    id: string;
    displayName: string;
    channel: Channel;
    externalId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metaData?: Record<string, any>;
    userId?: string;
}

export interface MessageMetaData {
    statusReason?: string;
    noOfRetriesLeft?: number;  
    eventId?: string;
    eventType?: string;
    lastSent?: {
        status: Status;
        timestamp: string;
        externalId?: string;
    };
    lastError?: {
        message: string;
        timestamp: string;
    };
}

export interface IMessage {
    id: string;
    externalId?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    externalMetaData?: Record<string, any>;
    from: Endpoint;
    sender: Endpoint;
    to: Endpoint;
    content: MessageContent;
    timestamp: Date;
    status: Status;
    type: MessageType;
    channel: Channel;
    metaData?: MessageMetaData;
}

export interface IMessageInput extends Omit<IMessage, 'from' | 'to' | 'sender' | 'id'> {
    fromId: string;
    toId: string;
    senderId: string;
}

export enum MessageContentType {
    text = 'text',
    image = 'image',
    video = 'video',
    audio = 'audio',
    pdf = 'pdf',
    document = 'document',
    location = 'location',
    contact = 'contact',
    template ='template'
}

export interface MessageContent {
    type: MessageContentType;
    text?: string;
    url?: string;
    templateName?: string;
    templateParams?: Record<string, string>;
}

export enum CallType {
    noAnswer = 'noAnswer',
    answered = 'answered',
    invalid = 'invalid',
    attempted = 'attempted',
    error = 'error',
    agentError = 'agentError'
}

export interface ICallRecord {
    id: string;
    from: Endpoint;
    to: Endpoint;
    initiator: Endpoint;
    type: CallType;
    recordingUrl?: string;
    durationInSeconds?: number;
    callStartTime: Date;
    details?: CallRecordDetails;
}

export interface CallRecordDetails {
    exotelCallCreationDetails?: string;
    exotelLatestStatus?: string;
}

export interface ICallRecordInput extends Omit<ICallRecord, 'from' | 'to' | 'initiator' | 'id'> {
    fromId: string;
    toId: string;
    initiatorId: string;
}

export interface Reaction {
    id: string;
    Channel: Channel;
    reactionType: ReactionType; // e.g., like, love, etc.
    comment?: string; // Optional comment
    endpointId: Endpoint; // Reference to the endpoint
}

export enum ReactionType {
    like = 'like',
    love = 'love',
    comment = 'comment',
    laugh = 'laugh',
    sad = 'sad',
    angry = 'angry',
    wow = 'wow'
}