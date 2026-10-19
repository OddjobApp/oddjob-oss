import { db } from "@server/database_service.js";
import { appAnalyticsDaily } from "@shared/schema/index.js";
import { sql, eq, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AnalyticsService");

export const analyticsService = {
    /**
     * Record a mission launch for an app deployment.
     * Increments launch count and tracks unique user engagement.
     */
    async recordLaunch(deploymentId: number, userId: string): Promise<void> {
        const today = new Date().toISOString().split('T')[0];

        try {
            // Atomic upsert for launch count
            await db.insert(appAnalyticsDaily)
                .values({
                    deploymentId,
                    date: today,
                    launchCount: 1,
                    uniqueUserCount: 1,
                })
                .onConflictDoUpdate({
                    target: [appAnalyticsDaily.deploymentId, appAnalyticsDaily.date],
                    set: {
                        launchCount: sql`${appAnalyticsDaily.launchCount} + 1`,
                        updatedAt: sql`NOW()`
                    }
                });

            logger.info("Recorded app launch", { deploymentId, today });
        } catch (error) {
            logger.error("Failed to record app launch", error, { deploymentId });
        }
    }
};


