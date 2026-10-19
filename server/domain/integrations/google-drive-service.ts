
import { google } from "googleapis";
import { Readable } from "stream";
import TurndownService from "turndown";

export interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    parents?: string[];
    webViewLink?: string; // Only populated when requested in `fields`
    data?: any; // For downloaded content
}

export class GoogleDriveClient {
    private auth: any;
    private drive: any;

    /**
     * `writable` lifts the auth scope from drive.readonly to drive. It defaults
     * to read-only so every caller that creates files must say so — the
     * previous constructor hardcoded readonly, which made every createFile()
     * call fail with a 403 no matter which credential was configured.
     */
    constructor(serviceAccountJson: string, options?: { writable?: boolean; scopes?: string[] }) {
        try {
            const credentials = JSON.parse(serviceAccountJson);
            const scopes = options?.scopes
                ?? (options?.writable
                    ? ['https://www.googleapis.com/auth/drive']
                    : ['https://www.googleapis.com/auth/drive.readonly']);
            this.auth = new google.auth.GoogleAuth({
                credentials,
                scopes,
            });
            this.drive = google.drive({ version: 'v3', auth: this.auth });
        } catch {
            // Not the parser's message: it quotes the input's first characters,
            // and the input is a secret (or, misconfigured, some other secret).
            throw new Error("Invalid Service Account JSON: the configured value is not a service-account key");
        }
    }

    /**
     * A client for OAuth-connected Drive connectors, whose tokens live in the
     * encrypted credential store rather than a service-account env var. The
     * caller hands in a token the OAuth adapter has already refreshed — there
     * is no client secret here, so googleapis cannot refresh on its own and
     * callers must go through the adapter (getValidAccessToken) rather than
     * caching the token.
     *
     * Scope is fixed at consent time — a token minted without a Drive scope
     * will 403 on every call, which callers should surface as "reconnect with
     * Drive access", not as a missing connection.
     */
    static fromAccessToken(accessToken: string): GoogleDriveClient {
        const client = Object.create(GoogleDriveClient.prototype) as GoogleDriveClient;
        const oauth2 = new google.auth.OAuth2();
        oauth2.setCredentials({ access_token: accessToken });
        (client as any).auth = oauth2;
        (client as any).drive = google.drive({ version: 'v3', auth: oauth2 });
        return client;
    }

    /**
     * List files in a folder (or root if not specified)
     */
    async listFiles(folderId?: string, pageToken?: string): Promise<{ files: DriveFile[], nextPageToken?: string }> {
        try {
            // If folderId is provided, search within it. Otherwise search root or assume "all" depending on requirements.
            // Usually we want to restrict to a specific folder tree for RAG.
            // If no folderId, maybe query 'root' in parents, or just query everything not trashed.
            let query = "trashed = false";
            if (folderId) {
                query += ` and '${folderId}' in parents`;
            }

            const res = await this.drive.files.list({
                q: query,
                pageSize: 50,
                pageToken,
                fields: 'nextPageToken, files(id, name, mimeType, parents)',
            });

            return {
                files: res.data.files || [],
                nextPageToken: res.data.nextPageToken || undefined,
            };
        } catch (error: any) {
            console.error("Error listing Drive files:", error.message);
            throw error;
        }
    }

    /**
     * Download or Export file content
     */
    async getFileContent(fileId: string, mimeType: string): Promise<{ buffer: Buffer, mimeType: string }> {
        try {
            // 1. Google Docs/Sheets/Slides -> Export
            if (mimeType === 'application/vnd.google-apps.document') {
                const res = await this.drive.files.export({
                    fileId,
                    mimeType: 'text/markdown', // Export as Markdown directly if supported, or text/plain
                }, { responseType: 'arraybuffer' });
                // Note: Drive API v3 export mimeType for Docs supports text/plain, not text/markdown usually? 
                // Let's check docs. 'text/plain' is safer, or 'text/html' then turndown.
                // Actually 'text/markdown' is supported for Docs now in some contexts, but 'text/plain' is safer fallback.
                // Let's try 'text/plain' for stability.
                return { buffer: Buffer.from(res.data), mimeType: 'text/plain' };
            }

            // 2. Binary files (PDF, Text, etc.) -> Get Media
            const res = await this.drive.files.get({
                fileId,
                alt: 'media',
            }, { responseType: 'arraybuffer' });

            return { buffer: Buffer.from(res.data), mimeType };

        } catch (error: any) {
            console.error(`Error downloading file ${fileId}:`, error.message);
            throw error;
        }
    }

    /**
     * Recursive folder walker helper
     */
    async *walkFolder(folderId: string): AsyncGenerator<DriveFile> {
        let pageToken: string | undefined = undefined;
        do {
            const result = await this.listFiles(folderId, pageToken);
            pageToken = result.nextPageToken;

            for (const file of result.files) {
                if (file.mimeType === 'application/vnd.google-apps.folder') {
                    yield* this.walkFolder(file.id);
                } else {
                    yield file;
                }
            }
        } while (pageToken);
    }

    /**
     * Create or Upload file content.
     *
     * `mimeType` is the *target* type. For a native workspace file
     * (application/vnd.google-apps.*) it goes on requestBody so Drive converts
     * the upload on import — putting it on `media` (the previous behaviour)
     * created a stored-bytes blob, not a Doc, and newer API versions reject it.
     * `uploadMimeType` is the format of `content`; text/plain and text/markdown
     * both convert cleanly to a Doc.
     */
    async createFile(name: string, content: string | Buffer, mimeType?: string, folderId?: string, uploadMimeType?: string): Promise<DriveFile> {
        try {
            const isGoogleWorkspaceType = mimeType?.startsWith('application/vnd.google-apps.') === true;

            const fileMetadata: any = {
                name,
                ...(isGoogleWorkspaceType ? { mimeType } : {}),
            };
            if (folderId) {
                fileMetadata.parents = [folderId];
            }

            const media = {
                mimeType: isGoogleWorkspaceType ? (uploadMimeType ?? 'text/plain') : mimeType,
                body: Readable.from(content instanceof Buffer ? content : Buffer.from(content)),
            };

            const res = await this.drive.files.create({
                requestBody: fileMetadata,
                media: media,
                // webViewLink is requested explicitly: Drive omits it unless
                // asked for, so callers recording a link to the created file
                // would otherwise always store undefined.
                fields: 'id, name, mimeType, webViewLink',
            });

            return res.data;
        } catch (error: any) {
            console.error(`Error creating file ${name}:`, error.message);
            throw error;
        }
    }
}


