import { Channel } from '../types/commTypes'; 
import { Reaction } from './commTypes'; 

export interface ChannelInfo {
    channel: Channel; // Enum for channel
    externalPostId?: string; // Optional external post ID
}

export interface PostCreateRequest {
    caption: string;
    authorId: string; // Reference to User
    channelInfo: ChannelInfo[]; // Renamed from channelName to channelInfo
    channelPostId?: string;
    mediaUrl?: string;
    orgId: string; // Reference to Org
}

export interface Post {
    id: string;
    caption: string;
    authorId: string; // Reference to User
    channelInfo: ChannelInfo[]; // Renamed from channelName to channelInfo
    channelPostId?: string;
    reactions?: Reaction[]; // Array of reactions (one-to-many)
    mediaUrl?: string;
    orgId: string; // Reference to Org
    createdAt: Date;
    updatedAt: Date;
}

export interface PostResponse {
    post: Post;
}
