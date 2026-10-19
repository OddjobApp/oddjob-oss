import { SupervisorPlan, SupervisorTask } from "@shared/schema/supervisor.js";
import { createLogger } from "../../../../utils/logger.js";

const logger = createLogger("TaskStateManager");

/**
 * TaskStateManager centralizes the logic for updating task statuses and handling retries.
 */
export class TaskStateManager {
    static transitionToInProgress(task: SupervisorTask, executionId: number, pipelineId: number) {
        task.status = "in_progress";
        task.childExecutionId = executionId;
        task.pipelineId = pipelineId;
        logger.info(`[TaskStateManager] Task ${task.id} transitioning to in_progress (Execution: ${executionId})`);
    }

    static completeTask(task: SupervisorTask, output: any) {
        task.status = "completed";
        task.output = output;
        logger.info(`[TaskStateManager] Task ${task.id} completed.`);
    }

    static transitionToWaiting(task: SupervisorTask, output: any) {
        task.status = "waiting_external_input";
        task.output = output;
        logger.info(`[TaskStateManager] Task ${task.id} transitioning to waiting_external_input.`);
    }

    static handleFailure(task: SupervisorTask, error: string, plan: SupervisorPlan): "retry" | "triage" | "fail" {
        const currentRetry = task.retryCount || 0;
        if (currentRetry < 3) {
            task.retryCount = currentRetry + 1;
            task.status = "pending";
            task.childExecutionId = undefined; // Reset for next attempt

            plan.history.push({
                type: "thought",
                observation: `Task ${task.id} failed. Retrying (Attempt ${task.retryCount}). Error: ${error}`,
                timestamp: new Date().toISOString()
            });

            logger.warn(`[TaskStateManager] Task ${task.id} failed. Scheduled retry ${task.retryCount}/3. Error: ${error}`);
            return "retry";
        } else {
            // New: Autonomous Triage Trigger
            if (plan.autoRescueEnabled && !task.lastTriageResult) {
                logger.info(`[TaskStateManager] Task ${task.id} failed after retries. Triggering Autonomous Triage.`);
                return "triage";
            }

            task.status = "failed";
            task.output = { error };
            logger.error(`[TaskStateManager] Task ${task.id} failed permanently after 3 retries. Error: ${error}`);
            return "fail";
        }
    }

    static transitionToTriage(task: SupervisorTask, recommendation: string, action: "relax" | "replan" | "skip" | "retry") {
        task.lastTriageResult = {
            recommendation,
            action,
            timestamp: new Date().toISOString()
        };
        logger.info(`[TaskStateManager] Task ${task.id} transitioned to triage status. Action: ${action}`);
    }

    static applyRescue(task: SupervisorTask, plan: SupervisorPlan) {
        if (!task.lastTriageResult) return;

        const { action, recommendation } = task.lastTriageResult;
        logger.info(`[TaskStateManager] Applying rescue action "${action}" for task ${task.id}`);

        plan.history.push({
            type: "thought",
            observation: `AUTONOMOUS RESCUE: Applying "${action}" to task ${task.id}. Reason: ${recommendation}`,
            timestamp: new Date().toISOString()
        });

        switch (action) {
            case "skip":
                task.status = "skipped";
                task.output = { skipped: true, reason: recommendation };
                break;
            case "retry":
                task.status = "pending";
                task.retryCount = 0; // Reset for the new strategy
                task.childExecutionId = undefined;
                break;
            case "relax":
                // Relaxing often requires context adjustment
                task.status = "pending";
                task.retryCount = 0;
                task.childExecutionId = undefined;
                plan.currentContext = (plan.currentContext || "") + `\nCONSTRAINTS RELAXED for task ${task.id}: ${recommendation}`;
                break;
            case "replan":
                task.status = "rejected"; // Force the supervisor to regroup
                break;
        }
    }

    static handleRejection(task: SupervisorTask, feedback: string, plan: SupervisorPlan) {
        task.status = "rejected";
        task.assignedAgentFeedback = feedback;
        plan.history.push({
            type: "critique",
            observation: `Task ${task.id} was rejected. Feedback: ${feedback}`,
            timestamp: new Date().toISOString()
        });
        logger.warn(`[TaskStateManager] Task ${task.id} rejected. Feedback: ${feedback}`);
    }
}


