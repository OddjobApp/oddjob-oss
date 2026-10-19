
import { Storage } from '@google-cloud/storage';
import { fileStorageSuccess } from './file-storage.js';
import path from 'path';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('StorageService');
const IS_GCP = process.env.NODE_ENV === 'production' || !!process.env.GOOGLE_CLOUD_PROJECT;
// Bucket name should be configurable via env, defaulting to the one used in infrastructure setup
const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'oddjob-dataset-uploads';

export interface StorageOptions {
    orgId: number | string | null;
    filePath: string;
}

/**
 * StorageService provides a unified interface for file operations.
 * In production (GCP), it attempts to use Google Cloud Storage.
 * In development, or as a fallback, it uses the local filesystem via FileStorageService.
 */
export const storageService = {
    /**
     * Saves a file to the configured storage provider.
     */
    async saveFile(orgId: number | string | null, filePath: string, content: Buffer | string): Promise<string> {
        if (IS_GCP) {
            try {
                const storage = new Storage();
                const bucket = storage.bucket(BUCKET_NAME);
                const blob = bucket.file(`${orgId || 'global'}/${filePath}`);

                await blob.save(content);
                logger.info(`File saved to GCS: gs://${BUCKET_NAME}/${blob.name}`);
                return `gs://${BUCKET_NAME}/${blob.name}`;
            } catch (error: any) {
                logger.error('Failed to save to GCS, falling back to local storage', { error });
                // Fallback to local on error
            }
        }

        // Local storage fallback
        return fileStorageSuccess.writeFile(orgId, filePath, content);
    },

    /**
     * Reads a file from the configured storage provider.
     */
    async readFile(orgId: number | string | null, filePath: string): Promise<Buffer> {
        if (IS_GCP) {
            try {
                const storage = new Storage();
                const bucket = storage.bucket(BUCKET_NAME);
                const blobName = filePath.includes('gs://') ? filePath.split(`${BUCKET_NAME}/`)[1] : `${orgId || 'global'}/${filePath}`;
                const blob = bucket.file(blobName);

                const [content] = await blob.download();
                return content;
            } catch (error: any) {
                logger.error('Failed to read from GCS, falling back to local storage', { error });
            }
        }

        return fileStorageSuccess.readBuffer(orgId, filePath);
    },

    /**
     * Lists files in a given folder.
     */
    async listFiles(orgId: number | string | null, folderPath: string): Promise<any[]> {
        if (IS_GCP) {
            try {
                const storage = new Storage();
                const bucket = storage.bucket(BUCKET_NAME);
                const prefix = `${orgId || 'global'}/${folderPath}`;

                const [files] = await bucket.getFiles({ prefix });
                return files.map(f => ({
                    name: path.basename(f.name),
                    path: f.name.replace(`${orgId || 'global'}/`, ''),
                    size: Number(f.metadata.size),
                    createdAt: new Date(f.metadata.timeCreated as string),
                    isDirectory: f.name.endsWith('/')
                }));
            } catch (error: any) {
                logger.error('Failed to list GCS files', { error });
            }
        }

        return fileStorageSuccess.listFiles(orgId, folderPath);
    },

    /**
     * Deletes a file from storage.
     */
    async deleteFile(orgId: number | string | null, filePath: string): Promise<void> {
        if (IS_GCP) {
            try {
                const storage = new Storage();
                const bucket = storage.bucket(BUCKET_NAME);
                const blobName = filePath.includes('gs://') ? filePath.split(`${BUCKET_NAME}/`)[1] : `${orgId || 'global'}/${filePath}`;
                const blob = bucket.file(blobName);

                await blob.delete();
                logger.info(`File deleted from GCS: ${blobName}`);
                return;
            } catch (error: any) {
                logger.error('Failed to delete from GCS, falling back to local storage', { error });
            }
        }

        return fileStorageSuccess.deleteFile(orgId, filePath);
    }
};

export default storageService;


