import { SupervisorPlan, SupervisorState, SupervisorWorkerOutputSchema, SupervisorTask } from "@shared/schema/supervisor.js";
import { pipelineExecutions, pipelineStepExecutions } from "@shared/schema/index.js";
import { db } from "@server/database_service.js";
import { eq, desc, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

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

    /**
     * Reconciles the plan with actual child execution statuses.
     */
    async syncStatuses(plan: SupervisorPlan, intent: string, orgId?: number): Promise<number> {
        let modifications = 0;
        const activeTasks = plan.tasks.filter((t: SupervisorTask) => t.status === "in_progress" && t.childExecutionId);

        for (const task of activeTasks) {
            const [execution] = await this.context.db
                .select()
                .from(pipelineExecutions)
                .where(eq(pipelineExecutions.id, task.childExecutionId!))
                .limit(1);

            if (execution) {
                if (execution.status === "completed") {
                    const output = await this.fetchExecutionOutput(task.childExecutionId!);

                    // Unified Protocol Detection
                    if (output.status === "rejected" || output.action === "critique") {
                        TaskStateManager.handleRejection(task, output.feedback || output.reason || "Rejected by worker", plan);
                        modifications++;
                    } else if (output.action === "handoff") {
                        TaskStateManager.handleRejection(task, `HANDOFF REQUEST: Please assign to ${output.to}. Reason: ${output.reason}`, plan);
                        modifications++;
                    } else {
                        // Qualitative & Constitutional Acceptance Criteria (Judging)
                        const { JudgeService } = await import("./judge-service.js");
                        const evaluationContent = output.result || (typeof output === 'string' ? output : JSON.stringify(output));
                        const contentStr = typeof evaluationContent === 'string' ? evaluationContent : JSON.stringify(evaluationContent);

                        const result = await JudgeService.evaluateTask(
                            intent,
                            task.description,
                            contentStr,
                            orgId
                        );

                        const constResult = await JudgeService.evaluateConstitution(
                            contentStr,
                            orgId
                        );

                        if (result.pass && constResult.pass) {
                            TaskStateManager.completeTask(task, output);
                        } else {
                            let feedback = "";
                            if (!result.pass) feedback += `QUALITATIVE FAILURE: ${result.feedback} `;
                            if (!constResult.pass) feedback += `CONSTITUTIONAL FAILURE: ${constResult.feedback}`;
                            
                            logger.warn(`[Supervisor] Task ${task.id} failed evaluation. Feedback: ${feedback.trim()}`);
                            TaskStateManager.handleRejection(task, feedback.trim(), plan);
                        }
                        modifications++;
                    }
                } else if (execution.status === "failed") {
                    TaskStateManager.handleFailure(task, execution.error || "Unknown error", plan);
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
        const pendingTasks = plan.tasks.filter((t: SupervisorTask) => t.status === "pending");
        const completedTaskIds = new Set(
            plan.tasks.filter((t: SupervisorTask) => t.status === "completed" || t.status === "skipped").map((t: SupervisorTask) => t.id)
        );

        return pendingTasks.filter((t: SupervisorTask) => t.dependencies.every((d: string) => completedTaskIds.has(d)));
    }

    /**
     * Determines the final state of the mission based on task statuses.
     */
    evaluateState(plan: SupervisorPlan): SupervisorState {
        const allCompleted = plan.tasks.every((t: SupervisorTask) => t.status === "completed" || t.status === "skipped");
        const anyFailed = plan.tasks.some((t: SupervisorTask) => t.status === "failed");
        const anyRejected = plan.tasks.some((t: SupervisorTask) => t.status === "rejected");
        const anyInProgress = plan.tasks.some((t: SupervisorTask) => t.status === "in_progress");

        if (anyRejected) return SupervisorState.REPLANNING;
        if (anyFailed) return SupervisorState.FAILED;
        if (allCompleted) return SupervisorState.COMPLETED;
        if (anyInProgress) return SupervisorState.WAITING;

        return SupervisorState.DELEGATING;
    }

    private async fetchExecutionOutput(executionId: number): Promise<any> {
        const [lastStep] = await this.context.db
            .select()
            .from(pipelineStepExecutions)
            .where(eq(pipelineStepExecutions.pipelineExecutionId, executionId))
            .orderBy(desc(pipelineStepExecutions.stepOrder))
            .limit(1);

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


