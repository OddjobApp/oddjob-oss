import { Job } from "bullmq";
import { QUEUE_NAMES } from "@domain/core/infrastructure/queue/queue-service.js";
import { heavyLogic, HeavyJobData } from "../domain/tools/v1/capabilities/generation.js";
import { BaseWorker } from "./base-worker.js";

export class HeavyWorker extends BaseWorker<HeavyJobData, string> {
    constructor() {
        super(QUEUE_NAMES.HEAVY_JOBS, {
            concurrency: 10,
            lockDuration: 300000, // 5 minutes
        });
    }

    protected async execute(job: Job<HeavyJobData>): Promise<string> {
        const { type, params, context } = job.data;
        const logic = (heavyLogic as any)[type];

        if (!logic) {
            throw new Error(`Unknown heavy job type: ${type}`);
        }

        return await logic(params, context);
    }
}

let workerInstance: HeavyWorker | null = null;

export function startHeavyWorker() {
    if (!workerInstance) {
        workerInstance = new HeavyWorker();
    }
    return workerInstance;
}

