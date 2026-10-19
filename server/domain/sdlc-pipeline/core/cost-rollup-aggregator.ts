/**
 * Cost Rollup Aggregator
 *
 * Aggregates cost data from mission runs and AI usage logs across all missions
 * in a generation session's operational cycle. Provides:
 *   - Total USD cost breakdown by phase and provider
 *   - Token usage aggregation
 *   - Budget threshold checking for pause/alert decisions
 */

import { db } from "@server/database_service.js";
import {
  generationSessions,
  missionRuns,
  aiUsageLogs,
} from "@shared/schema/index.js";
import { eq, and, isNull, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import type { CostBreakdown } from "./types.js";

const logger = createLogger("CostRollupAggregator");

// ============================================================================
// CALCULATE SESSION COST
// ============================================================================

/**
 * Calculate the full cost breakdown for a generation session.
 *
 * Strategy:
 *   1. Look up the session's cycleId from `generationSessions`
 *   2. Query all `missionRuns` where cycleId matches — sum their `costUsd` for
 *      the total and group by `name` for the byPhase breakdown
 *   3. Query `aiUsageLogs` joined to missionRuns via pipelineExecutionId —
 *      group by provider for byProvider breakdown and sum tokens
 */
export async function calculateSessionCost(sessionId: string): Promise<CostBreakdown> {
  // 1. Get the session's cycleId
  const [session] = await db
    .select({ cycleId: generationSessions.cycleId })
    .from(generationSessions)
    .where(eq(generationSessions.id, sessionId))
    .limit(1);

  if (!session?.cycleId) {
    logger.warn(`Session ${sessionId} not found or has no cycleId — returning zero cost`);
    return { totalUsd: 0, byPhase: {}, byProvider: {}, tokenCount: 0 };
  }

  const cycleId = session.cycleId;

  // 2. Aggregate missionRuns costs by phase (name)
  const phaseRows = await db
    .select({
      phase: missionRuns.name,
      cost: sql<string>`coalesce(sum(${missionRuns.costUsd}::numeric), 0)`,
    })
    .from(missionRuns)
    .where(and(eq(missionRuns.cycleId, cycleId), isNull(missionRuns.deletedAt)))
    .groupBy(missionRuns.name);

  const byPhase: Record<string, number> = {};
  let totalUsd = 0;

  for (const row of phaseRows) {
    const cost = parseFloat(String(row.cost));
    byPhase[row.phase] = cost;
    totalUsd += cost;
  }

  // 3. Aggregate aiUsageLogs by provider for token count and provider breakdown
  const providerRows = await db
    .select({
      provider: aiUsageLogs.provider,
      cost: sql<string>`coalesce(sum(${aiUsageLogs.costUsd}::numeric), 0)`,
      tokens: sql<string>`coalesce(sum(${aiUsageLogs.totalTokens}), 0)`,
    })
    .from(aiUsageLogs)
    .innerJoin(missionRuns, eq(aiUsageLogs.executionId, missionRuns.pipelineExecutionId))
    .where(and(eq(missionRuns.cycleId, cycleId), isNull(missionRuns.deletedAt)))
    .groupBy(aiUsageLogs.provider);

  const byProvider: Record<string, number> = {};
  let tokenCount = 0;

  for (const row of providerRows) {
    byProvider[row.provider] = parseFloat(String(row.cost));
    tokenCount += parseInt(String(row.tokens), 10);
  }

  logger.info(
    `Cost rollup for session=${sessionId} cycle=${cycleId}: $${totalUsd.toFixed(4)} total, ${tokenCount} tokens, ${phaseRows.length} phases, ${providerRows.length} providers`
  );

  return { totalUsd, byPhase, byProvider, tokenCount };
}

// ============================================================================
// CHECK THRESHOLD
// ============================================================================

/**
 * Check if a session's current cost exceeds the given percentage of its budget limit.
 *
 * Returns `true` if currentCost > (budgetLimitUsd * thresholdPercent / 100).
 * Returns `false` if no budget limit is configured.
 */
export async function checkThreshold(
  sessionId: string,
  thresholdPercent: number
): Promise<boolean> {
  // Get the session's budget limit
  const [session] = await db
    .select({ budgetLimitUsd: generationSessions.budgetLimitUsd })
    .from(generationSessions)
    .where(eq(generationSessions.id, sessionId))
    .limit(1);

  if (!session?.budgetLimitUsd) {
    // No budget configured — threshold cannot be exceeded
    return false;
  }

  const budgetLimit = parseFloat(String(session.budgetLimitUsd));
  if (budgetLimit <= 0) {
    return false;
  }

  // Calculate current cost
  const { totalUsd } = await calculateSessionCost(sessionId);

  const threshold = (budgetLimit * thresholdPercent) / 100;
  const exceeded = totalUsd > threshold;

  if (exceeded) {
    logger.warn(
      `Session ${sessionId} exceeded ${thresholdPercent}% budget threshold: $${totalUsd.toFixed(4)} > $${threshold.toFixed(4)} (limit: $${budgetLimit.toFixed(2)})`
    );
  }

  return exceeded;
}

// ============================================================================
// EXPORTED SERVICE OBJECT
// ============================================================================

export const costRollupAggregator = {
  calculateSessionCost,
  checkThreshold,
};
