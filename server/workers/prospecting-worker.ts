import { Job } from "bullmq";
import { BaseWorker } from "./base-worker.js";
import { QUEUE_NAMES } from "@domain/core/infrastructure/queue/queue-service.js";
import { prospectingService } from "../domain/prospecting/prospecting.service.js";

/**
 * Worker for processing background events dispatched from Oddjob Prospector JS Hook.
 */
export class ProspectingWorker extends BaseWorker<{
    propertyUid: string;
    prospectUid: string;
    cookieUid?: string;
    activity: string;
    payload: any;
    themes: string[];
}> {
    constructor() {
        super(QUEUE_NAMES.PROSPECTING, {
            concurrency: 20 // High concurrency for event ingest processing
        });
    }

    protected async execute(job: Job): Promise<any> {
        this.logger.debug(`Processing prospecting event for ${job.data.prospectUid} on ${job.data.propertyUid}`);

        // This offloads the synchronous Postgres read/write and LLM evaluation wait 
        // to our distributed worker nodes.
        const result = await prospectingService.processEvent(job.data);

        return result;
    }
}

let workerInstance: ProspectingWorker | null = null;
export function startProspectingWorker() {
    if (!workerInstance) {
        workerInstance = new ProspectingWorker();
    }
    return workerInstance;
}

