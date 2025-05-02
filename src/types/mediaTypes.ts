export interface TagAttributes {
    type: string;
    value: string;
}

export interface Tag extends TagAttributes {}

export interface MediaCreateRequest {
    url: string;
    contentType: string; // Change type to contentType
    branchId?: string;
    customerId?: string; // Add customerId as a nullable field
    tags?: Tag[]; // Add tags as a nullable field
}

export interface Media {
    id: string;
    url: string;
    contentType: string; // Change type to contentType
    branchId?: string;
    customerId?: string; // Add customerId as a nullable field
    tags?: Tag[]; // Add tags as a nullable field
    createdAt: Date;
    updatedAt: Date;
    createdBy: string;
    updatedBy: string;
}

export interface MediaResponse {
    media: Media;
}

export interface preSignedUrlRequest {
    fileName: string;
    contentType: string; // Change fileType to contentType
    customerId?: string;
    serviceProviderId?: string;
}

export interface PresignedUrlResponse {
    fileName: string;
    contentType: string; // Change fileType to contentType
    presignedUrl: string;
}
