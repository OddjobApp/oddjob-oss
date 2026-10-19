import { SupervisorPlan, SupervisorTask } from "@shared/schema/supervisor.js";
import { createLogger } from "@server/utils/logger.js";

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

    static handleFailure(task: SupervisorTask, error: string, plan: SupervisorPlan): boolean {
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
            return true; // Retrying
        } else {
            task.status = "failed";
            task.output = { error };
            logger.error(`[TaskStateManager] Task ${task.id} failed permanently after 3 retries. Error: ${error}`);
            return false; // Permanent failure
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


