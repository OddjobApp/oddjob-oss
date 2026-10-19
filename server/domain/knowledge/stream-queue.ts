import { Queue, Job } from 'bullmq';
import { BaseWorker } from "@server/workers/base-worker.js";
import { OntologyMappingSchema, OntologyMapper } from "./core/indexing/ontology-mapper.js"; // Adjust imports below once placed
import { type OrgContext } from "@server/utils/auth-context.js";
import { redisConnectionOptions } from "@domain/core/infrastructure/redis/connection-options.js";

const QUEUE_NAME = 'streaming-ingestion';

const redisOptions = {
    ...redisConnectionOptions(),
    enableOfflineQueue: true,
};

export const streamingQueue = new Queue(QUEUE_NAME, {
    connection: redisOptions,
    defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 5000 },
    }
});

interface StreamingJobData {
    payloads: Record<string, any>[];
    schema: OntologyMappingSchema;
    organizationId: number;
    missionId?: number;
}

/**
 * Worker responsible for picking up large batches of streaming webhook data
 * and passing them through the Ontology Mapper to integrate into the Knowledge Graph.
 */
export class StreamIngestorWorker extends BaseWorker<StreamingJobData> {
    constructor() {
        super(QUEUE_NAME, {
            concurrency: 10,  // High concurrency for streaming data
            limiter: {
                max: 100,     // Rate limit: 100 jobs per duration
                duration: 1000
            }
        });
    }

    protected async execute(job: Job<StreamingJobData>): Promise<any> {
        const { payloads, schema, organizationId, missionId } = job.data;
        
        try {
            this.logger.info(`Processing streaming payload batch of ${payloads.length} items for ${schema.entityType}`);
            
            const orgContext: OrgContext = { 
                organizationId, 
                userId: "system", 
                isAdmin: true, 
                isSuperAdmin: true, 
                isOrgAdmin: false 
            };
            
            // Map the streaming payloads directly into the Ontology
            await OntologyMapper.mapPayload(payloads, schema, orgContext, missionId);
            
            this.logger.info(`Stream batch processed successfully.`);
            return { success: true, processed: payloads.length };
        } catch (error: any) {
            this.logger.error(`Stream ingestion failed: ${error.message}`);
            throw error;
        }
    }
}

let streamWorkerInstance: StreamIngestorWorker | null = null;

export function startStreamWorker() {
    if (!streamWorkerInstance) {
        streamWorkerInstance = new StreamIngestorWorker();
    }
    return streamWorkerInstance;
}

export async function queueStreamBatch(data: StreamingJobData) {
    return await streamingQueue.add('ingest-stream-batch', data);
}
