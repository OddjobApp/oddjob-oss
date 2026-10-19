import { ErrorCategory, errorClassificationService } from "./error-classification.service.js";
import { createLogger } from "@server/utils/logger.js";
import { withRetry } from "./utils/retry.js";
import { decisionRouter } from "../../governor/core/decision-router.js";

const logger = createLogger("ErrorRecoveryService");

export class ErrorRecoveryService {
    async attemptRecovery(
        jobId: number,
        error: Error,
        context: any,
        retryOperation?: () => Promise<any>
    ): Promise<{
        recovered: boolean;
        action: string;
        result?: any;
    }> {
        const category = errorClassificationService.classify(error);

        switch (category) {
            case ErrorCategory.AUTHENTICATION:
                return await this.handleAuthError(jobId, context);
            case ErrorCategory.RATE_LIMIT:
                return await this.handleRateLimit(jobId, context, retryOperation);
            case ErrorCategory.TRANSIENT:
                return await this.handleTransientError(jobId, error, context, retryOperation);
            case ErrorCategory.BUILD_FAILURE:
                return await this.handleBuildFailure(jobId, error, context, retryOperation);
            case ErrorCategory.TEST_FAILURE:
                return await this.handleTestFailure(jobId, error, context, retryOperation);
            case ErrorCategory.DEPENDENCY_MISSING:
                return await this.handleDependencyMissing(jobId, error, context, retryOperation);
            case ErrorCategory.WORKSPACE_ERROR:
                return await this.handleWorkspaceError(jobId, error, context, retryOperation);
            default:
                return {
                    recovered: false,
                    action: errorClassificationService.getRecoveryAction(category),
                };
        }
    }

    private async handleAuthError(jobId: number, context: any) {
        logger.info(`Job ${jobId} failed with Auth Error. Manual credential refresh required.`);
        return {
            recovered: false,
            action: 'Manual credential refresh required',
        };
    }

    private async handleRateLimit(jobId: number, context: any, retryOperation?: () => Promise<any>) {
        if (!retryOperation) {
            return { recovered: false, action: "No retry operation provided" };
        }
        
        try {
            logger.info(`Job ${jobId} hit rate limit, waiting and retrying...`);
            const result = await withRetry(retryOperation, 3, 2000);
            return {
                recovered: true,
                action: `Recovered after rate limit delay`,
                result
            };
        } catch (err) {
            return {
                recovered: false,
                action: 'Rate limit recovery failed'
            };
        }
    }

    private async handleTransientError(jobId: number, error: Error, context: any, retryOperation?: () => Promise<any>) {
        if (!retryOperation) {
            return { recovered: false, action: "No retry operation provided" };
        }

        try {
            logger.info(`Job ${jobId} hit transient error, retrying with exponential backoff...`);
            const result = await withRetry(retryOperation, 3, 1000);
            return {
                recovered: true,
                action: `Recovered transient error`,
                result
            };
        } catch (err) {
            return {
                recovered: false,
                action: 'Transient error recovery failed'
            };
        }
    }

    /**
     * Handle build/compilation failures.
     * Auto-recovery: clear .next cache, rebuild, and retry.
     */
    private async handleBuildFailure(jobId: number, error: Error, context: any, retryOperation?: () => Promise<any>) {
        logger.info(`Job ${jobId} hit build failure. Attempting cache clear and rebuild...`);

        // Try to resolve workspace and clear build caches
        try {
            const { exec } = await import("child_process");
            const { promisify } = await import("util");
            const execAsync = promisify(exec);

            const workspace = context?.workspacePath || process.env.GIT_WORKSPACE_ROOT;
            if (workspace) {
                // Clear common build caches
                await execAsync("rm -rf .next dist .turbo .cache tsconfig.tsbuildinfo", { cwd: workspace, timeout: 15000 }).catch(() => {});
                logger.info(`[BuildRecovery] Cleared build caches in ${workspace}`);
            }
        } catch (cleanErr: any) {
            logger.warn(`[BuildRecovery] Cache clear failed: ${cleanErr.message}`);
        }

        if (!retryOperation) {
            return { recovered: false, action: "Build cache cleared. No retry operation provided — manual rebuild required." };
        }

        try {
            // Wait a moment for filesystem to settle, then retry
            await new Promise(r => setTimeout(r, 2000));
            const result = await retryOperation();
            return {
                recovered: true,
                action: "Recovered: cleared build cache and rebuilt successfully",
                result
            };
        } catch (err) {
            return {
                recovered: false,
                action: "Build cache cleared but rebuild still failed. Manual code fix required."
            };
        }
    }

    /**
     * Handle test failures.
     * These are usually code-level issues — don't auto-retry blindly,
     * but provide actionable context to the agent/operator.
     */
    private async handleTestFailure(jobId: number, error: Error, context: any, retryOperation?: () => Promise<any>) {
        logger.info(`Job ${jobId} hit test failure. Providing failure context for code fix.`);

        // Test failures are typically code issues — retry won't help unless the code changes.
        // The pipeline executor's on_fail route-to-step handles this by sending back to the coding step.
        return {
            recovered: false,
            action: `Test failure detected. Route back to coding step with error context: ${error.message.substring(0, 200)}`
        };
    }

    /**
     * Handle missing dependency errors.
     * Auto-recovery: run npm install and retry.
     */
    private async handleDependencyMissing(jobId: number, error: Error, context: any, retryOperation?: () => Promise<any>) {
        logger.info(`Job ${jobId} hit dependency error. Running npm install...`);

        try {
            const { exec } = await import("child_process");
            const { promisify } = await import("util");
            const execAsync = promisify(exec);

            const workspace = context?.workspacePath || process.env.GIT_WORKSPACE_ROOT;
            if (workspace) {
                await execAsync("npm install --legacy-peer-deps", { cwd: workspace, timeout: 120000 });
                logger.info(`[DependencyRecovery] npm install completed in ${workspace}`);
            }
        } catch (installErr: any) {
            logger.warn(`[DependencyRecovery] npm install failed: ${installErr.message}`);
            return {
                recovered: false,
                action: `Dependency recovery failed: ${installErr.message}`
            };
        }

        if (!retryOperation) {
            return { recovered: false, action: "Dependencies restored. No retry operation provided." };
        }

        try {
            const result = await retryOperation();
            return {
                recovered: true,
                action: "Recovered: ran npm install and retried successfully",
                result
            };
        } catch (err) {
            return {
                recovered: false,
                action: "Dependencies restored but operation still failed."
            };
        }
    }

    /**
     * Handle workspace/filesystem errors.
     * Auto-recovery: validate workspace health and attempt repair.
     */
    private async handleWorkspaceError(jobId: number, error: Error, context: any, retryOperation?: () => Promise<any>) {
        logger.info(`Job ${jobId} hit workspace error. Attempting workspace repair...`);

        try {
            const { exec } = await import("child_process");
            const { promisify } = await import("util");
            const execAsync = promisify(exec);

            const workspace = context?.workspacePath || process.env.GIT_WORKSPACE_ROOT;
            if (workspace) {
                // Reset any git lock files and clean up
                await execAsync("rm -f .git/index.lock", { cwd: workspace, timeout: 5000 }).catch(() => {});
                await execAsync("git checkout -- .", { cwd: workspace, timeout: 10000 }).catch(() => {});
                logger.info(`[WorkspaceRecovery] Git state cleaned in ${workspace}`);
            }
        } catch (repairErr: any) {
            logger.warn(`[WorkspaceRecovery] Repair failed: ${repairErr.message}`);
        }

        if (!retryOperation) {
            return { recovered: false, action: "Workspace repaired. No retry operation provided." };
        }

        try {
            const result = await retryOperation();
            return {
                recovered: true,
                action: "Recovered: workspace repaired and operation succeeded",
                result
            };
        } catch (err) {
            return {
                recovered: false,
                action: "Workspace repair attempted but operation still failed. Manual intervention required."
            };
        }
    }

    /**
     * Escalate an unrecoverable error to Human-in-the-Loop.
     */
    async escalateToHIL(jobId: number, error: Error, action: string, context: any) {
        try {
            const category = errorClassificationService.classify(error);
            await decisionRouter.requestDecision({
                sessionId: `hil_escalation_${jobId}_${Date.now()}`,
                jobId: jobId,
                executionId: context.executionId,
                tool: "error_escalation",
                params: {
                    type: "error_review",
                    error: error.message,
                    errorCategory: category,
                    suggestedAction: action,
                },
                goal: `Review and resolve ${category} error in Job ${jobId}`,
                riskLevel: category === ErrorCategory.WORKSPACE_ERROR ? "high" : "medium",
                description: `Job ${jobId} failed (${category}): ${error.message}. Suggested action: ${action}`,
                approverType: "internal",
                channels: ["inbox"],
                organizationId: context.organizationId,
                missionId: context.missionId,
                noWait: true,
            });
        } catch (escalationErr) {
            logger.error(`[ErrorRecovery] Failed to create HIL escalation:`, escalationErr);
        }
    }
}

export const errorRecoveryService = new ErrorRecoveryService();
