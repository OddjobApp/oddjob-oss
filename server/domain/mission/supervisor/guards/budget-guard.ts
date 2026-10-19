import { SupervisorGuard, GuardContext, GuardResult } from "./index.js";
import { SupervisorPlan } from "@shared/schema/supervisor.js";
import { governorService } from "@domain/governor/core/governor-service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("BudgetGuard");

/**
 * BudgetGuard ensures that the mission does not exceed configured financial limits.
 */
export class BudgetGuard implements SupervisorGuard {
    name = "BudgetGuard";

    async validate(plan: SupervisorPlan, context: GuardContext): Promise<GuardResult> {
        if (!context.governorConfig?.enabled || !context.governorConfig.rules) {
            return { allowed: true };
        }

        try {
            const result = await governorService.validateBudget({
                executionId: context.executionId,
                organizationId: context.organizationId
            }, context.governorConfig.rules);

            if (!result.allowed) {
                logger.warn(`[BudgetGuard] Budget validation failed: ${result.message}`);
                return {
                    allowed: false,
                    reason: `Financial limit reached: ${result.message}`,
                };
            }

            if (result.warning) {
                // Return allowed: true, but include the warning in metadata for the Supervisor to see
                return {
                    allowed: true,
                    metadata: { budgetWarning: result.warning }
                };
            }

            return { allowed: true };
        } catch (error: any) {
            logger.error(`[BudgetGuard] Error in BudgetGuard execution: ${error.message}`);
            return {
                allowed: true, // Fail open if the guard itself errors, but log it
            };
        }
    }
}


