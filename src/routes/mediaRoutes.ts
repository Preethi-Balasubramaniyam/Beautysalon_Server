import { Router } from 'express';
import { check, validationResult } from 'express-validator'; // Import express-validator
import Media from '../models/media';
import DBMedia from '../models/media';
import { User, UserScope } from '../types/userTypes'; // Import User type
import { MediaCreateRequest, preSignedUrlRequest, PresignedUrlResponse } from '../types/mediaTypes'; // Import types
import { authorize } from '../middleware/authorize';
import { getPresignedUrl, deleteS3Object } from '../services/s3Service'; // Import the S3 service
import express from 'express';

const router = Router();

const allowedContentTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf',
    'video/mp4',
    'video/avi',
    'video/mpeg',
    'audio/mpeg',
    'audio/mp4',
    'audio/wav',
    // Add other allowed content types here
];

// Route to add media
router.post(
    '/',
    authorize([UserScope.Manager]),
    [
        check('url').isURL().withMessage('Valid URL is required'),
        check('contentType').notEmpty().withMessage('Content type is required')
            .custom(value => allowedContentTypes.includes(value)).withMessage('Invalid media type'),
        check('branchId').optional({ nullable: true }).isString(),
        check('customerId').optional({ nullable: true }).isString(),
        check('tags').optional().isArray(),
        check('tags.*.type').optional().isString(),
        check('tags.*.value').optional().isString()
    ],
    async (req: express.Request, res: express.Response) => {
        console.log('Creating media');
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }
        try {
            const user: User = req.user;
            const mediaCreateRequest: MediaCreateRequest = req.body;
            const media = await Media.create(Media.toDBCreateModel(mediaCreateRequest, user));
            res.status(201).json({media: Media.fromDBModel(media)}); 
        } catch (error) {
            req.logger.error('Error creating message:', error);
            res.status(500).json({ error });
        }
    }
);

// Route to get all media for a branch
router.get(
    '/',
    authorize([UserScope.ReadOnlyUser]),
    async (req, res) => {
        try {
            const mediaList = await Media.getAllMedia(req.user.orgId);
            console.log('Media list:', mediaList.map(Media.fromDBModel)); 
            res.status(200).json({media:mediaList.map(item => (DBMedia.fromDBModel(item)))});
        } catch (error) {
            req.logger.error('Error creating message:', error);
            res.status(400).json({ error });
        }
    }
);

// Route to generate presigned URLs for media upload
router.post(
    '/presigned-urls',
    authorize([UserScope.ServiceProvider]),
    [
        check('files').isArray().withMessage('Files should be an array'),
        check('files.*.fileName').notEmpty().withMessage('File name is required'),
        check('files.*.contentType').notEmpty().withMessage('Content type is required')
            .custom(value => allowedContentTypes.includes(value)).withMessage('Invalid content type')
    ],
    async (req : express.Request, res: express.Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }
        try {
            const files: preSignedUrlRequest[] = req.body.files;
            const orgId = req.user.orgId;
            const presignedUrls: PresignedUrlResponse[] = [];
            for (const file of files) {
                const url = await getPresignedUrl(req.logger, file.fileName, file.contentType, orgId, file.customerId, file.serviceProviderId);
                const plainUrl = url.split('?')[0];
                const existingMedia = await Media.findOne({ where: { url: plainUrl } });
                if (existingMedia) {
                    res.status(400).json({ errors: [`Media with URL ${url} already exists`] });
                    return;
                }
                presignedUrls.push({ presignedUrl: url, fileName: file.fileName, contentType: file.contentType });
            }
            res.status(200).json({ presignedUrls });
        } catch (error: any) {
            req.logger.error('Error generating presigned URLs:', error);
            res.status(500).json({ error: error.message });
        }
    }
);

// Route to delete media
router.delete(
    '/:id',
    authorize([UserScope.Manager]),
    async (req: express.Request, res: express.Response) => {
        try {
            const mediaId = req.params.id;
            const media = await Media.findByPk(mediaId);

            if (!media) {
                res.status(404).json({ error: 'Media not found' });
                return;
            }

            await deleteS3Object(req.logger, media.url, req.user.orgId);
            await media.destroy();

            res.status(200).json({ message: 'Media deleted successfully' });
        } catch (error) {
            req.logger.error('Error deleting media:', error);
            res.status(500).json({ error });
        }
    }
);

export default router;