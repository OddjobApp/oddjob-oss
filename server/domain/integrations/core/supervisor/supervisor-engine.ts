import { SupervisorPlan, SupervisorState, SupervisorWorkerOutputSchema, SupervisorTask } from "@shared/schema/supervisor.js";
import { pipelineExecutions, pipelineStepExecutions } from "@shared/schema/index.js";
import { db } from "../../../../database_service.js";
import { eq, desc, and, inArray } from "drizzle-orm";
import { createLogger } from "../../../../utils/logger.js";

const logger = createLogger("SupervisorEngine");
import { TaskStateManager } from "./task-state-manager.js";

export interface EngineContext {
    db: typeof db;
    parentExecutionId: number;
}

/**
 * SupervisorEngine encapsulates the core mission logic.
 * It is responsible for:
 * 1. Syncing plan with actual execution statuses.
 * 2. Identifying ready-to-delegate tasks.
 * 3. Determining the overall mission state.
 */
export class SupervisorEngine {
    constructor(private context: EngineContext) { }

    async syncStatuses(plan: SupervisorPlan, intent: string, orgId?: number): Promise<number> {
        let modifications = 0;
        const activeTasks = plan.tasks.filter((t: any) => t.status === "in_progress" && t.childExecutionId);

        if (activeTasks.length === 0) return 0;

        const executionIds = activeTasks.map((t: any) => t.childExecutionId!);

        const executions = await this.context.db
            .select()
            .from(pipelineExecutions)
            .where(inArray(pipelineExecutions.id, executionIds));

        const executionsMap = new Map(executions.map(e => [e.id, e]));

        // Batch fetch execution outputs for completed tasks
        const completedExecutionIds = executions.filter(e => e.status === "completed").map(e => e.id);
        const lastStepsMap = new Map<number, any>();
        
        if (completedExecutionIds.length > 0) {
            const allSteps = await this.context.db
                .select()
                .from(pipelineStepExecutions)
                .where(inArray(pipelineStepExecutions.pipelineExecutionId, completedExecutionIds));
                
            for (const step of allSteps) {
                const current = lastStepsMap.get(step.pipelineExecutionId!);
                if (!current || step.stepOrder > current.stepOrder) {
                    lastStepsMap.set(step.pipelineExecutionId!, step);
                }
            }
        }

        for (const task of activeTasks) {
            const execution = executionsMap.get(task.childExecutionId!);

            if (execution) {
                if (execution.status === "completed") {
                    const lastStep = lastStepsMap.get(task.childExecutionId!);
                    const output = this.parseExecutionOutput(lastStep);

                    // Unified Protocol Detection
                    if (output.status === "rejected" || output.action === "critique") {
                        TaskStateManager.handleRejection(task, output.feedback || output.reason || "Rejected by worker", plan);
                        modifications++;
                    } else if (output.action === "handoff") {
                        logger.info(`[Supervisor] Handoff detected for task ${task.id} to ${output.to}. Generating Context Core...`);
                        
                        let handoffMessage = `HANDOFF REQUEST: Please assign to ${output.to}. Reason: ${output.reason}`;
                        
                        // --- TRUSTGRAPH INTEGRATION: SNAP FOR HANDOFF ---
                        try {
                            const { TrustGraphExportService } = await import("../../trustgraph/export.service.js");
                            const snapResult = await TrustGraphExportService.snapMission(this.context.parentExecutionId);
                            if (snapResult.success) {
                                handoffMessage += `\n\nCONTEXT CORE: ${snapResult.coreUrl}`;
                                logger.info(`[Supervisor] Handoff Context Core generated: ${snapResult.coreUrl}`);
                            }
                        } catch (err: any) {
                            logger.warn(`[Supervisor] Failed to generate handoff Context Core: ${err.message}`);
                        }

                        TaskStateManager.handleRejection(task, handoffMessage, plan);
                        modifications++;
                    } else {
                        // Qualitative Acceptance Criteria (Judging)
                        const { JudgeService } = await import("./judge-service.js");
                        const evaluationContent = output.result || (typeof output === 'string' ? output : JSON.stringify(output));

                        const result = await JudgeService.evaluateTask(
                            intent,
                            task.description,
                            typeof evaluationContent === 'string' ? evaluationContent : JSON.stringify(evaluationContent),
                            orgId
                        );

                        if (result.pass) {
                            TaskStateManager.completeTask(task, output);
                        } else {
                            logger.warn(`[Supervisor] Task ${task.id} failed qualitative judge evaluation. Feedback: ${result.feedback}`);
                            TaskStateManager.handleRejection(task, `QUALITATIVE FAILURE: ${result.feedback}`, plan);
                        }
                        modifications++;
                    }
                } else if (execution.status === "failed") {
                    const result = TaskStateManager.handleFailure(task, execution.error || "Unknown error", plan);
                    if (result === "triage") {
                        // Mark for triage in the next step
                        task.status = "rejected"; // Trigger replanning/triage state
                    }
                    modifications++;
                }
            }
        }
        return modifications;
    }

    /**
     * Identifies tasks that are ready to be executed (dependencies met).
     */
    getReadyTasks(plan: SupervisorPlan): SupervisorTask[] {
        const pendingTasks = plan.tasks.filter((t: any) => t.status === "pending");
        const completedTaskIds = new Set(
            plan.tasks.filter((t: any) => t.status === "completed" || t.status === "skipped").map((t: any) => t.id)
        );

        return pendingTasks.filter((t: any) => t.dependencies.every((d: any) => completedTaskIds.has(d)));
    }

    /**
     * Determines the final state of the mission based on task statuses.
     */
    evaluateState(plan: SupervisorPlan): SupervisorState {
        const allCompleted = plan.tasks.every((t: any) => t.status === "completed" || t.status === "skipped");
        const anyFailed = plan.tasks.some((t: any) => t.status === "failed");
        const anyRejected = plan.tasks.some((t: any) => t.status === "rejected");
        const triageNeeded = plan.tasks.some((t: any) => t.status === "rejected" && !t.lastTriageResult);
        const anyInProgress = plan.tasks.some((t: any) => t.status === "in_progress");
        const anyWaiting = plan.tasks.some((t: any) => t.status === "waiting_external_input");

        if (triageNeeded) return SupervisorState.TRIAGING;
        if (anyRejected) return SupervisorState.REPLANNING;
        if (anyFailed) return SupervisorState.FAILED;
        if (allCompleted) return SupervisorState.COMPLETED;
        if (anyInProgress || anyWaiting) return SupervisorState.WAITING;

        return SupervisorState.DELEGATING;
    }

    private parseExecutionOutput(lastStep: any): any {
        let rawOutput: any = { result: "Completed (No Output)" };
        if (lastStep?.output) {
            try {
                rawOutput = JSON.parse(lastStep.output);
            } catch (e) {
                rawOutput = { result: lastStep.output, parseError: true };
            }
        }

        const parseResult = SupervisorWorkerOutputSchema.safeParse(rawOutput);
        return parseResult.success ? parseResult.data : { ...rawOutput, parseError: !parseResult.success };
    }
}


