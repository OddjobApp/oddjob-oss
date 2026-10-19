import { Job } from "bullmq";
import { QUEUE_NAMES } from "@domain/core/infrastructure/queue/queue-service.js";

import { BaseWorker } from "./base-worker.js";


interface StepJobData {
    executionId: number;
    stepId: number;
    pipelineId: number;
    context: any;
    step: any; // PipelineStep
    isFirstStep: boolean;
    traceContext?: any;
}

export class StepWorker extends BaseWorker<StepJobData> {
    constructor() {
        super(QUEUE_NAMES.STEPS, {
            concurrency: 15,
        });
    }

    protected async execute(job: Job<StepJobData>): Promise<any> {
        const { executionId, stepId, pipelineId, context, step, isFirstStep, traceContext } = job.data;

        // Resource Monitoring Guard
        const { governorService } = await import("@domain/governor/index.js");
        const resourceCheck = await governorService.validateResourceLoad();
        if (!resourceCheck.allowed) {
            throw new Error(resourceCheck.message || "System under critical load");
        }

        // Merge traceContext (foreground trace) into variable context
        if (traceContext) {
            context.traceContext = traceContext;
        }

        // Fetch Pipeline
        const { pipelineService } = await import("../domain/pipeline/core/pipeline.service.js");
        const pipeline = await pipelineService.getSystem(pipelineId);
        if (!pipeline) {
            throw new Error(`Pipeline ${pipelineId} not found`);
        }

        // Execute the step logic
        const { executePipelineStep } = await import("../core/pipeline-step-runner.js");
        return await executePipelineStep(
            step,
            pipeline,
            context,
            isFirstStep,
            executionId
        );
    }
}

let workerInstance: StepWorker | null = null;

export function startStepWorker() {
    if (!workerInstance) {
        workerInstance = new StepWorker();
    }
    return workerInstance;
}

