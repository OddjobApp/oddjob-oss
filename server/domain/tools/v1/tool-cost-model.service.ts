/**
 * Measured cost model for tool execution.
 *
 * This is the foundation for ToolChain*-style planning. A* over a tool decision
 * tree is only as good as its cost function, and a cost function made of guesses
 * is a heuristic wearing a search algorithm — so this reads real history out of
 * `agent_tool_usage`, which the tool executor has been populating all along.
 *
 * The numbers justify the exercise. Observed spread across 16 tools:
 *
 *   get_pipeline_status          2 ms   17/17 success
 *   show_pipeline_input_form   165 ms   45/97 success
 *   search_unified_knowledge  15.7 s    85/85 success
 *   trigger_pipeline          51.1 s    16/17 success
 *
 * Four orders of magnitude. A planner that treats every step as unit cost cannot
 * tell a 2ms status check apart from a 51-second pipeline trigger.
 *
 * Cost is expected latency including expected retries, not raw latency: a tool
 * that succeeds 46% of the time is far more expensive than its mean suggests,
 * because the agent will call it again.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { agentToolUsage } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ToolCostModel");

/** How long a computed cost table stays warm. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Below this many observations a tool's own stats are too noisy to trust, so we
 * blend toward the global default rather than letting one unlucky call dominate.
 */
const MIN_CONFIDENT_SAMPLES = 5;

/** Assumed success rate for a tool with no history at all. */
const UNKNOWN_SUCCESS_RATE = 0.8;

/** Ceiling on modelled retries, so a near-always-failing tool stays finite. */
const MAX_EXPECTED_ATTEMPTS = 4;

export interface ToolCost {
    toolName: string;
    /** Observations backing these figures. 0 means the entry is a fallback. */
    samples: number;
    /** Mean observed latency of a single attempt, in ms. */
    meanLatencyMs: number;
    /** Median observed latency, which is far more robust to one slow outlier. */
    medianLatencyMs: number;
    successRate: number;
    /**
     * What the planner should actually minimise: median latency multiplied by
     * the expected number of attempts needed to get one success.
     */
    expectedCostMs: number;
    /** False when this entry was synthesised rather than measured. */
    measured: boolean;
}

export interface ToolCostTable {
    costs: Map<string, ToolCost>;
    /** Applied to any tool absent from `costs`. */
    fallback: ToolCost;
    computedAt: number;
    /** Total observations the table was built from. */
    totalSamples: number;
}

function expectedAttempts(successRate: number): number {
    if (successRate <= 0) return MAX_EXPECTED_ATTEMPTS;
    return Math.min(MAX_EXPECTED_ATTEMPTS, 1 / successRate);
}

function buildCost(
    toolName: string,
    samples: number,
    meanLatencyMs: number,
    medianLatencyMs: number,
    successRate: number,
    measured: boolean,
): ToolCost {
    return {
        toolName,
        samples,
        meanLatencyMs,
        medianLatencyMs,
        successRate,
        expectedCostMs: Math.round(medianLatencyMs * expectedAttempts(successRate)),
        measured,
    };
}

export class ToolCostModelService {
    private cache = new Map<string, { table: ToolCostTable; at: number }>();

    /**
     * Cost table for an org, falling back to cross-org history for tools the org
     * has never called. Pass `null` for the global table.
     */
    async getCostTable(organizationId: number | null, windowDays = 30): Promise<ToolCostTable> {
        const key = `${organizationId ?? "global"}:${windowDays}`;
        const hit = this.cache.get(key);
        if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.table;

        const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
        const conditions = [gte(agentToolUsage.createdAt, since)];
        if (organizationId !== null) {
            conditions.push(eq(agentToolUsage.organizationId, organizationId));
        }

        // percentile_cont gives a median that one 51-second outlier cannot drag.
        const rows = await db
            .select({
                toolName: agentToolUsage.toolName,
                samples: sql<number>`count(*)::int`,
                successes: sql<number>`sum((${agentToolUsage.status} = 'success')::int)::int`,
                meanMs: sql<number>`coalesce(avg(${agentToolUsage.executionTimeMs}), 0)::float`,
                medianMs: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${agentToolUsage.executionTimeMs}), 0)::float`,
            })
            .from(agentToolUsage)
            .where(and(...conditions))
            .groupBy(agentToolUsage.toolName);

        const costs = new Map<string, ToolCost>();
        let totalSamples = 0;
        let weightedLatency = 0;
        let totalSuccesses = 0;

        for (const r of rows) {
            const samples = Number(r.samples) || 0;
            if (samples === 0) continue;
            const successes = Number(r.successes) || 0;
            const rawRate = successes / samples;

            // Shrink a thin sample toward the neutral prior instead of trusting it.
            const weight = Math.min(1, samples / MIN_CONFIDENT_SAMPLES);
            const successRate = weight * rawRate + (1 - weight) * UNKNOWN_SUCCESS_RATE;

            costs.set(
                r.toolName,
                buildCost(r.toolName, samples, Number(r.meanMs), Number(r.medianMs), successRate, true),
            );

            totalSamples += samples;
            totalSuccesses += successes;
            weightedLatency += Number(r.medianMs) * samples;
        }

        const globalMedian = totalSamples > 0 ? weightedLatency / totalSamples : 1000;
        const globalRate = totalSamples > 0 ? totalSuccesses / totalSamples : UNKNOWN_SUCCESS_RATE;

        const table: ToolCostTable = {
            costs,
            fallback: buildCost("__unknown__", 0, globalMedian, globalMedian, globalRate, false),
            computedAt: Date.now(),
            totalSamples,
        };

        this.cache.set(key, { table, at: Date.now() });
        logger.info(
            `Cost table built for org=${organizationId ?? "global"}: ${costs.size} tools, ${totalSamples} observations`,
        );
        return table;
    }

    /** Cost for one tool, falling back when it has never been observed. */
    costOf(table: ToolCostTable, toolName: string): ToolCost {
        return table.costs.get(toolName) ?? { ...table.fallback, toolName };
    }

    /**
     * Cost of a candidate tool sequence — the g(n) a planner accumulates.
     * Sequential execution is assumed, matching how the agent loop runs today.
     */
    sequenceCost(table: ToolCostTable, toolNames: string[]): number {
        return toolNames.reduce((total, name) => total + this.costOf(table, name).expectedCostMs, 0);
    }

    /** Drops cached tables. Call after a bulk backfill of usage history. */
    invalidate(): void {
        this.cache.clear();
    }
}

export const toolCostModelService = new ToolCostModelService();
