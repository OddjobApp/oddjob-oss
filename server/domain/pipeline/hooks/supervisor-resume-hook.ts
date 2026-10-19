
import { db } from "@server/database_service.js";
import { pipelineExecutions, pipelineStepExecutions, jobs } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";


import { ExecutionHook, PipelineCompleteParams } from "./execution-hooks.js";
import { createLogger } from "@server/utils/logger.js";
import { asyncPollerUtils } from "../../core/async-poller-utils.js";

const logger = createLogger("SupervisorResumeHook");

export class SupervisorResumeHook implements ExecutionHook {
    name = "SupervisorResumeHook";

    async onPipelineComplete(params: PipelineCompleteParams): Promise<void> {
        const { pipelineExecution } = params;

        if (!pipelineExecution.parentExecutionId) {
            return;
        }

        logger.info(`Child execution ${pipelineExecution.id} completed. Checking parent ${pipelineExecution.parentExecutionId} for Supervisor resume.`);

        try {
            // Find the parent step execution that is waiting for this child
            // Supervisor jobs in 'waiting_async' status are the ones we want to poke
            const waitingSteps = await db.select()
                .from(pipelineStepExecutions)
                .innerJoin(jobs, eq(pipelineStepExecutions.jobId, jobs.id))
                .where(and(
                    eq(pipelineStepExecutions.pipelineExecutionId, pipelineExecution.parentExecutionId),
                    eq(pipelineStepExecutions.status, "waiting_async"),
                    eq(jobs.type, "supervisor")
                ));

            if (waitingSteps.length === 0) {
                logger.info(`No waiting Supervisor steps found in parent execution ${pipelineExecution.parentExecutionId}`);
                return;
            }

            for (const { pipeline_step_executions: stepExec, jobs: job } of waitingSteps) {
                // Hardening: Check lock and final status
                if (await asyncPollerUtils.isProcessing(stepExec.id)) {
                    logger.info(`Supervisor step ${stepExec.id} is already being processed. Skipping hook trigger.`);
                    continue;
                }

                try {
                    asyncPollerUtils.lock(stepExec.id);

                    // Re-verify status inside lock (Double-checked locking pattern)
                    const [latestStep] = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.id, stepExec.id)).limit(1);
                    if (!latestStep || latestStep.status !== "waiting_async") {
                        logger.info(`Supervisor step ${stepExec.id} status changed to ${latestStep?.status}. Aborting hook.`);
                        continue;
                    }

                    logger.info(`Triggering immediate resume for Supervisor step ${stepExec.id} in parent ${pipelineExecution.parentExecutionId}`);

                    if (!latestStep.output) continue;

                    let plan;
                    try {
                        plan = JSON.parse(latestStep.output);
                    } catch (e) {
                        logger.error(`Invalid plan JSON in supervisor step ${latestStep.id}`);
                        continue;
                    }

                    // Call executePlan (event-driven tick)
                    const { supervisorService } = await import("../../integrations/core/supervisor.service.js");
                    const result = await supervisorService.executePlan(
                        plan,
                        pipelineExecution.parentExecutionId,
                        "system-hook",
                        job.organizationId || undefined,
                        undefined,
                        job.id
                    );

                    // Update the output with the latest plan state
                    const { executionManager } = await import("../core/execution-manager.js");
                    await executionManager.updateStepExecution(latestStep.id, {
                        output: JSON.stringify(result.plan)
                    });

                    if (result.state === "completed") {
                        logger.info(`Supervisor Step ${latestStep.id} completed via event trigger.`);
                        await executionManager.updateStepExecution(latestStep.id, {
                            status: "success",
                            completedAt: new Date()
                        });
                        const { pipelineExecutor } = await import("../../../core/pipeline-executor.js");
                        await pipelineExecutor.resumePipelineExecution(pipelineExecution.parentExecutionId);
                    } else if (result.state === "failed") {
                        const errorTask = result.plan.tasks.find((t: any) => t.status === "failed");
                        logger.error(`Supervisor plan failed at task '${errorTask?.name}' via event trigger.`);

                        await executionManager.updateStepExecution(latestStep.id, {
                            status: "failed",
                            completedAt: new Date(),
                            error: `Supervisor plan failed at task '${errorTask?.name}'`
                        } as any);

                        await executionManager.updateExecution(pipelineExecution.parentExecutionId, {
                            status: "failed",
                            completedAt: new Date(),
                            error: `Step ${latestStep.stepOrder} failed (Supervisor)`
                        });
                    } else {
                        logger.info(`Supervisor Step ${latestStep.id} progressed to state: ${result.state}. Still waiting.`);
                    }
                } finally {
                    asyncPollerUtils.unlock(stepExec.id);
                }
            }
        } catch (error) {
            logger.error(`Error in SupervisorResumeHook for execution ${pipelineExecution.id}:`, error);
        }
    }
}


