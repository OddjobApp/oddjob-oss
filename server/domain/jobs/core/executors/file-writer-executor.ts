
import { Job, Pipeline, FileWriterConfig, CloudStorageMetadata } from "@shared/schema/index.js";
import { type VariableContext } from "@server/core/variable-resolver.js";
import { type StepExecutionResult } from "@server/core/pipeline-step-runner.js";
import { type JobExecutor } from "./index.js";
import { fileStorage } from "@domain/knowledge/core/file-storage.js";
import { db } from "@server/database_service.js";
import { credentials } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import path from 'path';
import { AppError, ErrorCode } from "@server/utils/errors.js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Storage as GCSStorage } from "@google-cloud/storage";
import { google } from "googleapis";

export class FileWriterExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "file_writer";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as FileWriterConfig;

        // 1. Resolve Credentials if needed
        let credentialMetadata: CloudStorageMetadata | null = null;
        if (config.destination !== 'local') {
            if (!config.credentialId) {
                throw new AppError(`Credential ID is required for ${config.destination} destination`, 400, ErrorCode.VALIDATION_FAILED);
            }

            // Fetch credential
            const [cred] = await db.select().from(credentials).where(eq(credentials.id, config.credentialId));
            if (!cred) {
                throw new AppError(`Credential #${config.credentialId} not found`, 404, ErrorCode.NOT_FOUND);
            }

            // Validate type
            if (cred.type !== 'cloud_storage') {
                throw new AppError(`Credential #${config.credentialId} is not a Cloud Storage credential`, 400, ErrorCode.VALIDATION_FAILED);
            }

            credentialMetadata = cred.metadata as CloudStorageMetadata;
        }

        // 2. Prepare Content (Format & Encode)
        let contentBuffer: Buffer;
        let contentString: string = config.content;

        // Auto-convert Objects/Arrays if format is raw/json but content came in as object (from variable substitution)
        if (typeof config.content !== 'string') {
            if (config.format === 'raw' || config.format === 'json') {
                contentString = JSON.stringify(config.content, null, 2);
            } else {
                // For CSV, we handle it below
                contentString = JSON.stringify(config.content);
            }
        }

        if (config.format === 'csv') {
            let input: any = config.content;
            // Parse if string
            if (typeof input === 'string') {
                try { input = JSON.parse(input); } catch { }
            }

            // Ensure array
            if (!Array.isArray(input)) {
                if (typeof input === 'object' && input !== null) {
                    input = [input];
                } else {
                    throw new AppError("Content must be an array or object for CSV export", 400, ErrorCode.VALIDATION_FAILED);
                }
            }

            const { stringify } = await import('csv-stringify/sync');
            const csvOutput = stringify(input, { header: true });
            contentBuffer = Buffer.from(csvOutput, 'utf8'); // CSV is always utf8 text
        } else if (config.format === 'json') {
            // If we already stringified it above, great. If not, parsing might be needed to pretty print?
            // If the user passed a raw string that IS json, we might want to re-format it?
            // For now, assume contentString is the intended output unless it's an object.
            if (typeof config.content === 'object') {
                contentBuffer = Buffer.from(JSON.stringify(config.content, null, 2), 'utf8');
            } else {
                // Try to prettify if it looks like JSON?
                try {
                    const obj = JSON.parse(contentString);
                    contentBuffer = Buffer.from(JSON.stringify(obj, null, 2), 'utf8');
                } catch {
                    contentBuffer = Buffer.from(contentString, 'utf8');
                }
            }
        } else {
            // RAW
            if (config.encoding === 'base64') {
                contentBuffer = Buffer.from(contentString, 'base64');
            } else {
                contentBuffer = Buffer.from(contentString, 'utf8');
            }
        }

        // 3. Write to Destination
        let outputMessage = "";

        switch (config.destination) {
            case 'local': {
                // Determine Org
                let orgId: number | string | null = job.organizationId || null;
                if (!orgId && pipeline.organizationId) orgId = pipeline.organizationId;
                if (!orgId) throw new AppError("Organization ID required for local file write", 400, ErrorCode.VALIDATION_FAILED);

                const savedPath = await fileStorage.saveFileWithMode(
                    orgId,
                    config.path,
                    contentBuffer,
                    config.onConflict || 'overwrite'
                );
                outputMessage = `Saved local file to ${path.relative(process.cwd(), savedPath)}`;
                break;
            }

            case 'aws_s3': {
                if (credentialMetadata?.provider !== 'aws') {
                    throw new AppError(`Credential is not for AWS (found ${credentialMetadata?.provider})`, 400, ErrorCode.VALIDATION_FAILED);
                }

                if (!config.bucket) {
                    throw new AppError("Bucket name is required for S3 destination", 400, ErrorCode.VALIDATION_FAILED);
                }

                const s3Client = new S3Client({
                    region: credentialMetadata.region || "us-east-1",
                    credentials: {
                        accessKeyId: credentialMetadata.accessKeyId,
                        secretAccessKey: credentialMetadata.secretAccessKey
                    }
                });

                await s3Client.send(new PutObjectCommand({
                    Bucket: config.bucket,
                    Key: config.path,
                    Body: contentBuffer,
                    ACL: config.acl as any || undefined,
                    ContentType: config.format === 'json' ? 'application/json' : (config.format === 'csv' ? 'text/csv' : 'application/octet-stream')
                }));

                outputMessage = `Uploaded to S3: s3://${config.bucket}/${config.path}`;
                break;
            }

            case 'google_cloud_storage': {
                if (credentialMetadata?.provider !== 'gcp') {
                    throw new AppError(`Credential is not for GCP (found ${credentialMetadata?.provider})`, 400, ErrorCode.VALIDATION_FAILED);
                }
                if (!config.bucket) {
                    throw new AppError("Bucket name is required for Google Cloud Storage destination", 400, ErrorCode.VALIDATION_FAILED);
                }

                const gcs = new GCSStorage({
                    projectId: credentialMetadata.projectId,
                    credentials: {
                        client_email: credentialMetadata.clientEmail,
                        private_key: credentialMetadata.privateKey,
                    },
                });

                const mimeType =
                    config.format === 'json' ? 'application/json' :
                    config.format === 'csv'  ? 'text/csv' :
                    'application/octet-stream';

                await gcs.bucket(config.bucket).file(config.path).save(contentBuffer, {
                    metadata: { contentType: mimeType },
                    resumable: false,
                });

                outputMessage = `Uploaded to GCS: gs://${config.bucket}/${config.path}`;
                break;
            }

            case 'google_drive': {
                if (credentialMetadata?.provider !== 'google_drive') {
                    throw new AppError(`Credential is not for Google Drive (found ${credentialMetadata?.provider})`, 400, ErrorCode.VALIDATION_FAILED);
                }

                const auth = new google.auth.OAuth2(
                    credentialMetadata.clientId,
                    credentialMetadata.clientSecret
                );
                auth.setCredentials({ refresh_token: credentialMetadata.refreshToken });

                const drive = google.drive({ version: 'v3', auth });
                const fileName = path.basename(config.path);
                const mimeTypeDrive =
                    config.format === 'json' ? 'application/json' :
                    config.format === 'csv'  ? 'text/csv' :
                    'application/octet-stream';

                const { Readable } = await import('stream');
                const fileStream = Readable.from(contentBuffer);

                const driveFile = await drive.files.create({
                    requestBody: {
                        name: fileName,
                        ...(config.bucket ? { parents: [config.bucket] } : {}),
                    },
                    media: {
                        mimeType: mimeTypeDrive,
                        body: fileStream,
                    },
                    fields: 'id,name,webViewLink',
                });

                outputMessage = `Uploaded to Google Drive: ${driveFile.data.webViewLink || driveFile.data.id}`;
                break;
            }

            case 'azure_blob':
            case 'onedrive':
                throw new AppError(`Destination '${config.destination}' is not yet implemented. Please use 'local', 'aws_s3', 'google_cloud_storage', or 'google_drive'.`, 501, ErrorCode.INTERNAL_ERROR);

            default:
                throw new AppError(`Unknown destination: ${config.destination}`, 400, ErrorCode.VALIDATION_FAILED);
        }

        return {
            success: true,
            output: outputMessage,
            status: "success"
        };
    }
}


