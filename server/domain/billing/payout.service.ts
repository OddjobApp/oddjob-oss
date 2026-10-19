import { db } from "@server/database_service.js";
import { appPayouts, apps } from "@shared/schema/index.js";
import { eq, sql, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("PayoutService");

export const payoutService = {
    /**
     * Record a payout for a successful mission launch.
     * @param missionRunId - used as idempotency key to prevent double-payouts if the event fires twice.
     */
    async recordAppLaunchPayout(appId: number, missionRunId?: number) {
        try {
            const [app] = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);
            if (!app || !app.developerOrgId) return;

            const price = parseFloat(app.pricePerLaunchUsd || '0');
            if (price <= 0) return;

            // Idempotency: skip if we already recorded a payout for this mission run
            if (missionRunId !== undefined) {
                const [existing] = await db.select({ id: appPayouts.id })
                    .from(appPayouts)
                    .where(and(eq(appPayouts.appId, appId), eq(appPayouts.missionRunId, missionRunId)))
                    .limit(1);
                if (existing) {
                    logger.debug(`Payout already recorded for app ${appId} / run ${missionRunId}, skipping`);
                    return;
                }
            }

            const payoutPercentage = app.developerPayoutPercentage || 70;
            const developerShare = (price * payoutPercentage) / 100;

            await db.insert(appPayouts).values({
                appId,
                developerOrgId: app.developerOrgId,
                amountUsd: developerShare.toFixed(6),
                status: "pending",
                createdAt: new Date(),
                ...(missionRunId !== undefined ? { missionRunId } : {}),
            });

            logger.info(`Recorded $${developerShare.toFixed(2)} payout for app ${app.slug} (${appId})`);
        } catch (err) {
            logger.error("Failed to record app launch payout", { appId, error: err });
        }
    },

    /**
     * Get accrued earnings for an organization
     */
    async getAccruedEarnings(orgId: number) {
        const result = await db.select({
            total: sql<string>`sum(amount_usd)`
        })
            .from(appPayouts)
            .where(eq(appPayouts.developerOrgId, orgId));

        return parseFloat(result[0]?.total || '0');
    },

    /**
     * List payout history for an organization
     */
    async listPayouts(orgId: number, limit = 200) {
        return await db.select()
            .from(appPayouts)
            .where(eq(appPayouts.developerOrgId, orgId))
            .orderBy(sql`created_at desc`)
            .limit(limit);
    }
};


