/**
 * Critique → Prompt Fitness Updater
 *
 * Aggregates agentCritiques scores onto promptVersions.fitnessScore,
 * closing the evolutionary prompt loop.
 *
 * Intended to run nightly (cron) or triggered manually via the admin API.
 */

import { db } from "@server/database_service.js";
import { eq, and, sql, gte } from "drizzle-orm";
import { agentCritiques } from "@shared/schema/agent/index.js";
import { promptVersions, promptPerformanceLogs } from "@shared/schema/learning/index.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CritiqueFitnessUpdater");

export const critiqueFitnessUpdater = {
    /**
     * Run the aggregation pass over all prompt versions that have received
     * new critiques since `since` (defaults to 24 h ago).
     */
    async run(since?: Date): Promise<{ updated: number; skipped: number }> {
        const cutoff = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000);

        logger.info(`[CritiqueFitness] Starting aggregation pass (cutoff: ${cutoff.toISOString()})`);

        // Fetch all active / experimental prompt versions
        const versions = await db.select({
            id: promptVersions.id,
            versionId: promptVersions.versionId,
            organizationId: promptVersions.organizationId,
        }).from(promptVersions).where(
            sql`${promptVersions.status} IN ('active', 'experimental')`
        );

        let updated = 0;
        let skipped = 0;

        for (const version of versions) {
            try {
                const result = await this.updateVersion(version.id, version.versionId, cutoff);
                if (result) updated++;
                else skipped++;
            } catch (err: any) {
                logger.error(`[CritiqueFitness] Failed to update version ${version.versionId}: ${err.message}`);
                skipped++;
            }
        }

        logger.info(`[CritiqueFitness] Pass complete — updated: ${updated}, skipped: ${skipped}`);
        return { updated, skipped };
    },

    /**
     * Updates a single prompt version's fitnessScore from recent critiques.
     * Returns true if an update was written.
     */
    async updateVersion(promptVersionDbId: number, versionId: string, since: Date): Promise<boolean> {
        // Critiques are linked to prompt versions via promptPerformanceLogs.promptVersionId
        // which shares the string versionId. We aggregate average critique scores.
        const critiqueAgg = await db.select({
            avgScore: sql<number>`avg(${agentCritiques.score})`,
            count: sql<number>`count(*)`,
        })
            .from(agentCritiques)
            .innerJoin(
                promptPerformanceLogs,
                and(
                    eq(promptPerformanceLogs.id, agentCritiques.interactionId),
                    eq(promptPerformanceLogs.promptVersionId, promptVersionDbId)
                )
            )
            .where(gte(agentCritiques.createdAt, since));

        const agg = critiqueAgg[0];
        if (!agg || agg.count === 0) return false;

        // Normalise: critiques are 0–10, fitness score is 0–100
        const critiqueContribution = (Number(agg.avgScore) / 10) * 100;

        // Blend with existing fitness score (60% existing, 40% new critique signal)
        const [current] = await db.select({ fitnessScore: promptVersions.fitnessScore })
            .from(promptVersions)
            .where(eq(promptVersions.id, promptVersionDbId))
            .limit(1);

        const existingFitness = Number(current?.fitnessScore) || 0;
        const newFitness = existingFitness * 0.6 + critiqueContribution * 0.4;

        await db.update(promptVersions)
            .set({
                fitnessScore: String(Math.round(newFitness * 100) / 100),
                updatedAt: new Date(),
            })
            .where(eq(promptVersions.id, promptVersionDbId));

        logger.debug(`[CritiqueFitness] Version ${versionId}: avgCritiqueScore=${agg.avgScore.toFixed(2)}, newFitness=${newFitness.toFixed(2)}`);
        return true;
    },
};
