import { db } from "@server/database_service.js";
import { appUserUsage, appDeployments } from "@shared/schema/index.js";
import { and, eq, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CostAttributionService");

export const costAttributionService = {
    /**
     * Record spend for a specific user within an app deployment
     */
    async recordAppUserSpend(deploymentId: number, userId: string, costUsd: number) {
        if (!userId || userId === 'anonymous') {
            logger.debug(`Skipping spend recording for anonymous user in deployment ${deploymentId}`);
            return;
        }
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // Using upsert logic with Drizzle
            await db.insert(appUserUsage)
                .values({
                    deploymentId,
                    userId,
                    dailySpendUsd: costUsd.toFixed(6),
                    monthlySpendUsd: costUsd.toFixed(6),
                    lastSpendAt: new Date(),
                    updatedAt: new Date(),
                })
                .onConflictDoUpdate({
                    target: [appUserUsage.deploymentId, appUserUsage.userId],
                    set: {
                        dailySpendUsd: sql`CASE 
                            WHEN last_spend_at < ${today.toISOString()} THEN ${costUsd.toFixed(6)}::numeric
                            ELSE daily_spend_usd + ${costUsd.toFixed(6)}::numeric
                        END`,
                        monthlySpendUsd: sql`CASE 
                            WHEN date_trunc('month', last_spend_at) < date_trunc('month', ${today.toISOString()}::timestamp) THEN ${costUsd.toFixed(6)}::numeric
                            ELSE monthly_spend_usd + ${costUsd.toFixed(6)}::numeric
                        END`,
                        lastSpendAt: new Date(),
                        updatedAt: new Date()
                    }
                });

            logger.debug(`Recorded $${costUsd} user spend for deployment ${deploymentId}, user ${userId}`);
        } catch (err) {
            logger.error("Failed to record app user spend", { deploymentId, userId, error: err });
        }
    },

    /**
     * Check if a user is within their budget limits
     */
    async checkUserBudget(deploymentId: number, userId: string): Promise<{ allowed: boolean, reason?: string }> {
        try {
            // 1. Get deployment limits
            const [deployment] = await db.select({
                userBudgetLimit: appDeployments.userBudgetLimit,
                totalBudgetLimit: appDeployments.budgetLimitUsd,
                currentOrgSpend: appDeployments.currentSpendUsd
            })
                .from(appDeployments)
                .where(eq(appDeployments.id, deploymentId))
                .limit(1);

            if (!deployment) return { allowed: true }; // Should not happen if called correctly

            // 2. Check org limit first
            if (deployment.totalBudgetLimit && parseFloat(deployment.currentOrgSpend) >= parseFloat(deployment.totalBudgetLimit)) {
                return { allowed: false, reason: "Organization-wide app budget exceeded" };
            }

            // 3. Check user limit
            if (deployment.userBudgetLimit) {
                const [usage] = await db.select()
                    .from(appUserUsage)
                    .where(and(
                        eq(appUserUsage.deploymentId, deploymentId),
                        eq(appUserUsage.userId, userId)
                    ))
                    .limit(1);

                if (usage) {
                    const limit = parseFloat(deployment.userBudgetLimit);
                    const spent = parseFloat(usage.dailySpendUsd); // Default to daily limit for now as per simple req

                    if (spent >= limit) {
                        return { allowed: false, reason: "Individual daily budget for this app exceeded" };
                    }
                }
            }

            return { allowed: true };
        } catch (err) {
            logger.error("Error checking user budget", { deploymentId, userId, error: err });
            return { allowed: true }; // Fail open for UX, but log error
        }
    },

    /**
     * Generate a CSV export of all spend for a deployment
     */
    async exportUsageToCSV(deploymentId: number): Promise<string> {
        const usageData = await db.select()
            .from(appUserUsage)
            .where(eq(appUserUsage.deploymentId, deploymentId));

        if (usageData.length === 0) return "User ID,Daily Spend (USD),Monthly Spend (USD)\n";

        let csv = "User ID,Daily Spend (USD),Monthly Spend (USD)\n";
        usageData.forEach((row: any) => {
            csv += `${row.userId},${row.dailySpendUsd},${row.monthlySpendUsd}\n`;
        });

        return csv;
    }
};


