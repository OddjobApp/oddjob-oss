/**
 * Job Queue — thin BullMQ dispatch layer.
 *
 * Real worker processes are started in index.ts / worker-entrypoint.ts.
 * This module exists for backwards-compatibility with callers that import
 * executeStepViaQueue / stepQueue from this path.
 */

/**
 * No-op — real workers are registered via startStepWorker() et al. in index.ts.
 * Kept for import compatibility.
 */
export function startWorker(): null {
    return null;
}

/**
 * Enqueue a pipeline step onto the BullMQ steps queue and wait for the result.
 * Falls back to direct execution in pipeline-executor.ts if Redis is unavailable.
 */
export async function executeStepViaQueue(step: any, pipeline: any, context: any) {
    const { queueService } = await import("@domain/core/infrastructure/queue/queue-service.js");

    const jobData = {
        executionId: context?.executionId ?? 0,
        stepId: step.id,
        pipelineId: pipeline.id,
        context,
        step,
        isFirstStep: context?.isFirstStep ?? false,
        traceContext: context?.traceContext,
    };

    const job = await queueService.addJobWithTrace(
        queueService.stepsQueue,
        "execute-step",
        jobData,
        { attempts: 1, removeOnComplete: 100, removeOnFail: 50 },
    );

    return (job as any).waitUntilFinished(queueService.stepsEvents);
}

/**
 * Direct reference to the BullMQ steps queue for callers that need raw queue access.
 */
export const stepQueue = {
    add: async (name: string, data: any, opts?: any) => {
        const { queueService } = await import("@domain/core/infrastructure/queue/queue-service.js");
        return queueService.stepsQueue.add(name, data, opts);
    },
    waitUntilFinished: async (job: any) => {
        const { queueService } = await import("@domain/core/infrastructure/queue/queue-service.js");
        return job.waitUntilFinished(queueService.stepsEvents);
    },
} as any;

