import { Queue, Job } from 'bullmq';
import { db } from "@server/database_service.js";
import { knowledgeDocumentExtractions, extractionBatches } from "@shared/schema/index.js";
import { eq, sql } from "drizzle-orm";
import { KnowledgeExtractionService } from "./core/extraction/knowledge-extraction.js";
import { BaseWorker } from "@server/workers/base-worker.js";
import { redisConnectionOptions } from "@domain/core/infrastructure/redis/connection-options.js";

const QUEUE_NAME = 'knowledge-extractions';

// 1. Define Queue
const redisOptions = {
    ...redisConnectionOptions(),
    enableOfflineQueue: true,
};

export const extractionQueue = new Queue(QUEUE_NAME, {
    connection: redisOptions,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 1000 },
    }
});

// Interface for Job Data
interface ExtractionJobData {
    type: 'document' | 'dataset' | 'documentation';
    extractionId?: number;
    documentId?: number;
    featureId?: string;
    datasetId?: number;
    schemaId: number;
    organizationId: number | null;
    batchId?: number;
}

// 2. Define Worker
export class ExtractionWorker extends BaseWorker<ExtractionJobData> {
    constructor() {
        super(QUEUE_NAME, {
            concurrency: 1, // Reduced from 5 to prevent event loop stalls during ingestion
            limiter: {
                max: 10,
                duration: 1000
            }
        });
    }

    protected async execute(job: Job<ExtractionJobData>): Promise<any> {
        const { extractionId, documentId, datasetId, schemaId, organizationId, batchId } = job.data;
        // Jobs enqueued without `type` (the retired knowledge-queue.service.ts
        // producer omitted it) used to fall through every branch and return
        // success, leaving the extraction row queued forever. Infer it; if it
        // still can't be determined, throw so the job fails visibly.
        const type: string | undefined =
            job.data.type ?? (documentId ? 'document' : datasetId ? 'dataset' : undefined);
        const extractionService = new KnowledgeExtractionService();

        try {
            this.logger.info(`Processing ${type} extraction ${extractionId}`);

            if (type === 'document') {
                if (!documentId) throw new Error("documentId is required for document extraction");

                // Update status to processing
                await db.update(knowledgeDocumentExtractions)
                    .set({
                        status: "processing",
                        startedAt: new Date(),
                        bullmqJobId: job.id,
                        progress: 0,
                        progressMessage: "Starting extraction...",
                        error: null,
                        errorDetails: null
                    })
                    .where(eq(knowledgeDocumentExtractions.id, extractionId!));

                // Update batch progress if applicable
                if (batchId) {
                    await db.execute(sql`
                        UPDATE ${extractionBatches}
                        SET 
                            status = 'running',
                            started_at = COALESCE(started_at, NOW()),
                            current_document_id = ${documentId}
                        WHERE id = ${batchId}
                    `);
                }

                // Report progress helper
                const reportProgress = async (progress: number, message: string) => {
                    await job.updateProgress(progress);
                    await db.update(knowledgeDocumentExtractions)
                        .set({ progress, progressMessage: message })
                        .where(eq(knowledgeDocumentExtractions.id, extractionId!));
                };

                await reportProgress(10, "Loading document content");

                // Execute extraction
                if (!extractionId || !documentId) {
                    throw new Error("extractionId and documentId are required for document extraction");
                }

                await extractionService.processExtractionTask(extractionId, documentId, schemaId, organizationId, async (p, msg) => {
                    await reportProgress(p, msg);
                });

                this.logger.info(`Extraction ${extractionId} completed`);

                // Update batch stats and check for completion (success)
                if (batchId) {
                    await db.execute(sql`
                        UPDATE ${extractionBatches} 
                        SET 
                            processed_documents = processed_documents + 1,
                            successful_documents = successful_documents + 1,
                            total_nodes_extracted = total_nodes_extracted + (SELECT nodes_extracted FROM ${knowledgeDocumentExtractions} WHERE id = ${extractionId}),
                            total_edges_extracted = total_edges_extracted + (SELECT edges_extracted FROM ${knowledgeDocumentExtractions} WHERE id = ${extractionId}),
                            progress = LEAST(100, FLOOR((processed_documents + 1) * 100.0 / NULLIF(total_documents, 0))),
                            status = CASE WHEN processed_documents + 1 >= total_documents THEN 'completed' ELSE status END,
                            completed_at = CASE WHEN processed_documents + 1 >= total_documents THEN NOW() ELSE completed_at END
                        WHERE id = ${batchId}
                    `);
                }
            } else if (type === 'dataset') {
                if (!datasetId) throw new Error("datasetId is required for dataset extraction");
                
                // For now, we reuse the extraction process for all items in the dataset
                // In a real implementation, we would likely update a 'dataset_extraction' record
                this.logger.info(`Dataset extraction started for ${datasetId}`);
                await extractionService.processDatasetItems(datasetId, schemaId, organizationId, async (p, msg) => {
                    await job.updateProgress(p);
                    this.logger.info(`Dataset Extraction Progress: ${p}% - ${msg}`);
                });
            } else if (type === 'documentation') {
                const { featureId } = job.data;
                this.logger.info(`Documentation generation started for feature: ${featureId}`);
                // Use a placeholder delay to simulate work
                await job.updateProgress(50);
                await new Promise(resolve => setTimeout(resolve, 2000));
                await job.updateProgress(100);
            } else {
                throw new Error(`Unknown extraction job type: ${String(type)}`);
            }

            return { success: true };
        } catch (e: any) {
            this.logger.error(`Worker failed for extraction ${extractionId}:`, e);

            if (type === 'document' && extractionId) {
                // Update db status to failed
                await db.update(knowledgeDocumentExtractions)
                    .set({
                        status: "failed",
                        error: e.message,
                        completedAt: new Date()
                    })
                    .where(eq(knowledgeDocumentExtractions.id, extractionId));

                // Update batch stats and check for completion (failure)
                if (batchId) {
                    await db.execute(sql`
                        UPDATE ${extractionBatches} 
                        SET 
                            processed_documents = processed_documents + 1,
                            failed_documents = failed_documents + 1,
                            progress = LEAST(100, FLOOR((processed_documents + 1) * 100.0 / NULLIF(total_documents, 0))),
                            status = CASE WHEN processed_documents + 1 >= total_documents THEN 'completed' ELSE status END,
                            completed_at = CASE WHEN processed_documents + 1 >= total_documents THEN NOW() ELSE completed_at END,
                            error_summary = error_summary || ${JSON.stringify([{ docId: documentId, error: e.message }])}::jsonb
                        WHERE id = ${batchId}
                    `);
                }
            }

            throw e;
        }
    }
}

let workerInstance: ExtractionWorker | null = null;

export function startExtractionWorker() {
    if (!workerInstance) {
        workerInstance = new ExtractionWorker();
    }
    return workerInstance;
}


// Helper to add to queue
export async function queueExtractionJob(data: ExtractionJobData, priority: number = 0) {
    let jobName = 'extract-document';
    let id: any = data.extractionId;
    
    if (data.type === 'dataset') {
        jobName = 'extract-dataset';
        id = data.datasetId;
    } else if (data.type === 'documentation') {
        jobName = 'generate-documentation';
        id = data.featureId;
    }

    return await extractionQueue.add(jobName, data, {
        priority,
        jobId: `extraction-${data.type}-${id}-${Date.now()}` // Use timestamp to avoid deduplication for manual retries
    });
}
