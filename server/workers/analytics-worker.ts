import { Job } from "bullmq";
import { QUEUE_NAMES } from "@domain/core/infrastructure/queue/queue-service.js";
import { usageService } from "@domain/admin/core/usage.service.js";
import { BaseWorker } from "./base-worker.js";

export class AnalyticsWorker extends BaseWorker {
    constructor() {
        super(QUEUE_NAMES.ANALYTICS, {
            concurrency: 5, // Handle multiple logs in parallel
        });
    }

    protected async execute(job: Job): Promise<any> {
        const { type, data } = job.data;

        if (type === "logAIUsageDirect" || type === "logAIUsage") {
            return await (usageService as any).logAIUsageDirect(data);
        } else {
            this.logger.warn(`Unknown job type: ${type}`);
        }
    }
}

let workerInstance: AnalyticsWorker | null = null;

export function startAnalyticsWorker() {
    if (!workerInstance) {
        workerInstance = new AnalyticsWorker();
    }
    return workerInstance;
}

