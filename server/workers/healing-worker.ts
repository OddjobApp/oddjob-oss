import { Job } from "bullmq";
import { QUEUE_NAMES } from "@domain/core/infrastructure/queue/queue-service.js";
import { aiHealingService } from "@domain/ai/core/ai-healing.service.js";
import { BaseWorker } from "./base-worker.js";
import { createChildSpan } from "@domain/core/infrastructure/tracing/trace-context.service.js";

export interface HealingJobData {
    type: 'selector' | 'json';
    missionId: number;
    context: any;
    traceContext?: any;
}

export interface HealingJobResult {
    success: boolean;
    output?: string;
    error?: string;
}

export class HealingWorker extends BaseWorker<HealingJobData, HealingJobResult> {
    constructor() {
        super(QUEUE_NAMES.HEALING, {
            concurrency: 5,
            limiter: {
                max: 50,
                duration: 1000
            }
        });
    }

    protected async execute(job: Job<HealingJobData>): Promise<HealingJobResult> {
        const { type, missionId, context } = job.data;
        let { traceContext } = job.data;

        this.logger.info(`Processing healing job ${job.id} for mission ${missionId}`, { type });

        if (traceContext) {
            traceContext = createChildSpan(traceContext);
        }

        try {
            let result: string | null = null;

            if (type === 'selector') {
                result = await aiHealingService.healSelectorV2(
                    context.brokenSelector,
                    context.pageHtml,
                    context.errorContext,
                    context.strategy || 'proximity'
                );
            } else if (type === 'json') {
                result = await aiHealingService.healJson(
                    context.malformedJson,
                    context.description
                );
            }

            if (result) {
                return { success: true, output: result };
            } else {
                return { success: false, error: "AI failed to heal the asset" };
            }
        } catch (err: any) {
            this.logger.error(`Healing job ${job.id} failed`, { error: err.message });
            return { success: false, error: err.message };
        }
    }
}

let workerInstance: HealingWorker | null = null;

export function startHealingWorker() {
    if (!workerInstance) {
        workerInstance = new HealingWorker();
    }
    return workerInstance;
}
