import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from './database';
import User from './user';
import { Reaction } from '../types/commTypes'; // Use Channel from commTypes
import { PostCreateRequest, Post as PostInterface, ChannelInfo } from '../types/postTypes'; // Import ChannelInfo

interface PostAttributes {
    id: string;
    caption: string;
    authorId: string; // Reference to User
    channelInfo: ChannelInfo[]; // Renamed from channelName to channelInfo
    channelPostId?: string;
    reactions?: Reaction[]; // Array of references
    mediaUrl?: string;
    orgId: string; // Reference to Org
    createdAt: Date;
    updatedAt: Date;
}

type PostCreationAttributes = Optional<PostAttributes, 'id' | 'channelPostId' | 'reactions' | 'mediaUrl'>;

class Post extends Model<PostAttributes, PostCreationAttributes> implements PostAttributes {
    public id!: string;
    public caption!: string;
    public authorId!: string;
    public channelInfo!: ChannelInfo[]; // Renamed from channelName to channelInfo
    public channelPostId?: string;
    public reactions?: Reaction[];
    public mediaUrl?: string;
    public orgId!: string;

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;

    // This function converts PostCreateRequest to PostCreationAttributes format for DB creation
    public static toDBCreateModel(input: PostCreateRequest): PostCreationAttributes {
        return {
            caption: input.caption,
            authorId: input.authorId,
            channelInfo: input.channelInfo, // Renamed from channelName to channelInfo
            channelPostId: input.channelPostId,
            mediaUrl: input.mediaUrl,
            orgId: input.orgId,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
    }

    // This function maps DB model (Post) to PostInterface
    public static fromDBModel(post: Post): PostInterface {
        return {
            id: post.id,
            caption: post.caption,
            authorId: post.authorId,
            channelInfo: post.channelInfo, // Renamed from channelName to channelInfo
            channelPostId: post.channelPostId,
            reactions: post.reactions,
            mediaUrl: post.mediaUrl,
            orgId: post.orgId,
            createdAt: post.createdAt,
            updatedAt: post.updatedAt,
        };
    }
}

Post.init(
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        caption: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        authorId: {
            type: DataTypes.UUID,
            allowNull: false,
            references: {
                model: User,
                key: 'id',
            },
        },
        channelInfo: {
            type: DataTypes.JSON, // Renamed from channelName to channelInfo
            allowNull: false,
        },
        channelPostId: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        reactions: {
            type: DataTypes.JSON, // Store reactions as JSON
            allowNull: true,
        },
        mediaUrl: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        orgId: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        createdAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
        updatedAt: {
            type: DataTypes.DATE,
            allowNull: false,
            defaultValue: DataTypes.NOW,
        },
    },
    {
        sequelize,
        tableName: 'Posts',
    }
);

Post.belongsTo(User, {
    foreignKey: 'authorId',
    as: 'author',
});

export default Post;
