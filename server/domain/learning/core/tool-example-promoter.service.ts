/**
 * Tool Example Auto-Promoter
 *
 * Promotes high-quality agentToolUsage records into agentToolExamples for
 * few-shot injection, making the example library self-maintaining.
 *
 * Promotion criteria:
 *  - status = 'success'
 *  - executionTimeMs within 2σ of the per-tool mean (not an outlier)
 *  - No duplicate example for the same (toolName, taskType) already exists
 *    with successScore > 0.8
 */

import { db } from "@server/database_service.js";
import { eq, and, sql, gte, isNotNull } from "drizzle-orm";
import { agentToolUsage, agentToolExamples } from "@shared/schema/agent/index.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ToolExamplePromoter");

// Minimum number of successful runs before we start promoting examples
const MIN_RUNS_BEFORE_PROMOTE = 5;

export const toolExamplePromoter = {
    /**
     * Scan recent successful tool usages and promote qualifying ones into examples.
     * @param since  Only consider runs created after this timestamp (default: 7 days)
     */
    async run(since?: Date): Promise<{ promoted: number; skipped: number }> {
        const cutoff = since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        logger.info(`[ToolExamplePromoter] Starting promotion pass (cutoff: ${cutoff.toISOString()})`);

        // 1. Find all tools that have enough successful runs
        const toolStats = await db.select({
            toolName: agentToolUsage.toolName,
            taskType: agentToolUsage.taskType,
            count: sql<number>`count(*)`,
            avgMs: sql<number>`avg(${agentToolUsage.executionTimeMs})`,
            stdMs: sql<number>`stddev(${agentToolUsage.executionTimeMs})`,
        })
            .from(agentToolUsage)
            .where(
                and(
                    eq(agentToolUsage.status, 'success'),
                    gte(agentToolUsage.createdAt, cutoff),
                    isNotNull(agentToolUsage.taskType)
                )
            )
            .groupBy(agentToolUsage.toolName, agentToolUsage.taskType)
            .having(sql`count(*) >= ${MIN_RUNS_BEFORE_PROMOTE}`);

        let promoted = 0;
        let skipped = 0;

        for (const stat of toolStats) {
            try {
                const result = await this.promoteForTool(stat, cutoff);
                if (result) promoted++;
                else skipped++;
            } catch (err: any) {
                logger.error(`[ToolExamplePromoter] Failed for tool ${stat.toolName}/${stat.taskType}: ${err.message}`);
                skipped++;
            }
        }

        logger.info(`[ToolExamplePromoter] Pass complete — promoted: ${promoted}, skipped: ${skipped}`);
        return { promoted, skipped };
    },

    async promoteForTool(
        stat: { toolName: string; taskType: string | null; count: number; avgMs: number; stdMs: number },
        since: Date
    ): Promise<boolean> {
        const { toolName, taskType, avgMs, stdMs } = stat;
        if (!taskType) return false;

        // Check if we already have a high-quality example for this pairing
        const existing = await db.query.agentToolExamples.findFirst({
            where: and(
                eq(agentToolExamples.toolName, toolName),
                eq(agentToolExamples.taskType, taskType),
                gte(agentToolExamples.successScore, 0.8)
            ),
        });

        if (existing) return false; // Already covered

        // Find a representative run: successful, within 2σ of mean execution time, has both input and output
        const twoSigmaLow = Math.floor(Math.max(0, avgMs - 2 * (stdMs || avgMs)));
        const twoSigmaHigh = Math.ceil(avgMs + 2 * (stdMs || avgMs));

        const candidates = await db.select({
            id: agentToolUsage.id,
            toolName: agentToolUsage.toolName,
            taskType: agentToolUsage.taskType,
            taskDescription: agentToolUsage.taskDescription,
            inputParams: agentToolUsage.inputParams,
            outputData: agentToolUsage.outputData,
            reasoning: agentToolUsage.reasoning,
            executionTimeMs: agentToolUsage.executionTimeMs,
        })
            .from(agentToolUsage)
            .where(
                and(
                    eq(agentToolUsage.toolName, toolName),
                    eq(agentToolUsage.taskType, taskType),
                    eq(agentToolUsage.status, 'success'),
                    gte(agentToolUsage.createdAt, since),
                    isNotNull(agentToolUsage.inputParams),
                    isNotNull(agentToolUsage.outputData),
                    sql`${agentToolUsage.executionTimeMs} BETWEEN ${twoSigmaLow} AND ${twoSigmaHigh}`
                )
            )
            .limit(1);

        if (candidates.length === 0) return false;

        const run = candidates[0];

        const examplePrompt = run.taskDescription ||
            `Use ${toolName} for ${taskType}: ${JSON.stringify(run.inputParams).slice(0, 200)}`;
        const exampleOutput = JSON.stringify(run.outputData).slice(0, 500);

        // Calculate a success score based on how close to mean execution time
        const deviation = Math.abs((run.executionTimeMs ?? avgMs) - avgMs) / (stdMs || 1);
        const successScore = Math.max(0.5, Math.min(1.0, 1 - deviation / 3));

        await db.insert(agentToolExamples).values({
            toolName,
            taskType,
            examplePrompt,
            exampleOutput,
            successScore,
            usageCount: 0,
        });

        logger.info(`[ToolExamplePromoter] Promoted example for ${toolName}/${taskType} (score: ${successScore.toFixed(2)})`);
        return true;
    },
};
