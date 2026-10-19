import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { aiUsageLogs, pipelines } from "@shared/schema/index.js";
import { eq, and, gte, sql } from "drizzle-orm";
import { startOfMonth } from "date-fns";

const logger = createLogger("BudgetService");

export const budgetService = {
    /**
     * Check if a pipeline has exceeded its monthly budget
     */
    async checkPipelineBudget(pipelineId: number): Promise<{
        allowed: boolean;
        currentSpend: number;
        budget: number | null;
        message?: string;
    }> {
        try {
            const [pipeline] = await db
                .select()
                .from(pipelines)
                .where(eq(pipelines.id, pipelineId))
                .limit(1);

            if (!pipeline) {
                return {
                    allowed: true,
                    currentSpend: 0,
                    budget: null,
                    message: "Pipeline not found",
                };
            }

            const budget = pipeline.monthlyBudgetUsd ? parseFloat(pipeline.monthlyBudgetUsd) : null;

            if (!budget) {
                return {
                    allowed: true,
                    currentSpend: 0,
                    budget: null,
                };
            }

            const startOfCurrentMonth = startOfMonth(new Date());

            const [usage] = await db
                .select({
                    totalSpent: sql<number>`COALESCE(SUM(${aiUsageLogs.costUsd}::numeric), 0)`,
                })
                .from(aiUsageLogs)
                .where(
                    and(
                        eq(aiUsageLogs.pipelineId, pipelineId),
                        gte(aiUsageLogs.createdAt, startOfCurrentMonth)
                    )
                );

            const currentSpend = Number(usage?.totalSpent || 0);
            const allowed = currentSpend < budget;

            if (!allowed) {
                logger.warn(
                    `[Budget Service] Pipeline ${pipelineId} exceeded budget: $${currentSpend.toFixed(2)} / $${budget.toFixed(2)}`
                );
            }

            return {
                allowed,
                currentSpend,
                budget,
                message: allowed
                    ? undefined
                    : `Pipeline has exceeded monthly budget ($${currentSpend.toFixed(2)} / $${budget.toFixed(2)})`,
            };
        } catch (error: any) {
            logger.error("[BudgetService] Budget check failed:", error);
            return {
                allowed: true,
                currentSpend: 0,
                budget: null,
                message: "Budget check failed, allowing execution",
            };
        }
    },

    async getPipelineCurrentMonthSpend(pipelineId: number): Promise<number> {
        const startOfCurrentMonth = startOfMonth(new Date());

        const [usage] = await db
            .select({
                totalSpent: sql<number>`COALESCE(SUM(${aiUsageLogs.costUsd}::numeric), 0)`,
            })
            .from(aiUsageLogs)
            .where(
                and(
                    eq(aiUsageLogs.pipelineId, pipelineId),
                    gte(aiUsageLogs.createdAt, startOfCurrentMonth)
                )
            );

        return Number(usage?.totalSpent || 0);
    }
};
