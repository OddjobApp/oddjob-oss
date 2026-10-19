import { db } from "@server/database_service.js";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import {
    costLedger,
    type CostLedgerEntry,
    type InsertCostLedgerEntry,
} from "@shared/schema/cost-ledger.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CostLedgerService");

// ============================================================================
// COST LEDGER SERVICE
// Records granular per-LLM-call costs in the cost_ledger table.
// Supplements orgSettings.currentMonthSpendUsd (which tracks the org-level
// monthly total) with per-agent, per-mission, per-model attribution.
// ============================================================================

export interface CostLedgerQueryOptions {
    startDate?: Date;
    endDate?: Date;
    agentDeploymentId?: number;
    missionId?: number;
    model?: string;
    limit?: number;
    offset?: number;
}

export interface AgentMonthlySummary {
    agentDeploymentId: number | null;
    totalCostUsd: number;
    totalTokensPrompt: number;
    totalTokensCompletion: number;
    callCount: number;
}

class CostLedgerService {
    /**
     * Records a single LLM call's cost into the cost_ledger table.
     * Called from system-config.service.ts trackSpend() after tracking org totals.
     */
    async record(entry: InsertCostLedgerEntry): Promise<void> {
        try {
            await db.insert(costLedger).values({
                ...entry,
                costUsd: entry.costUsd !== undefined && entry.costUsd !== null ? String(entry.costUsd) : undefined,
                tokensTotal:
                    (entry.tokensPrompt ?? 0) + (entry.tokensCompletion ?? 0),
            });
        } catch (e: any) {
            // Log but don't throw — cost recording failures must not block agent execution
            logger.error(`Failed to record cost ledger entry: ${e.message}`, {
                orgId: entry.orgId,
                model: entry.model,
            });
        }
    }

    /**
     * Returns paginated cost ledger entries for an org with optional filters.
     */
    async getLedger(
        orgId: number,
        options: CostLedgerQueryOptions = {},
    ): Promise<{ entries: CostLedgerEntry[]; total: number }> {
        const {
            startDate,
            endDate,
            agentDeploymentId,
            missionId,
            model,
            limit = 50,
            offset = 0,
        } = options;

        const conditions = [eq(costLedger.orgId, orgId)];

        if (startDate) {
            conditions.push(gte(costLedger.recordedAt, startDate));
        }
        if (endDate) {
            conditions.push(lte(costLedger.recordedAt, endDate));
        }
        if (agentDeploymentId !== undefined) {
            conditions.push(
                eq(costLedger.agentDeploymentId, agentDeploymentId),
            );
        }
        if (missionId !== undefined) {
            conditions.push(eq(costLedger.missionId, missionId));
        }
        if (model) {
            conditions.push(eq(costLedger.model, model));
        }

        const where = and(...conditions);

        const [countResult] = await db
            .select({ count: sql<number>`COUNT(*)::int` })
            .from(costLedger)
            .where(where);

        const entries = await db
            .select()
            .from(costLedger)
            .where(where)
            .orderBy(desc(costLedger.recordedAt))
            .limit(limit)
            .offset(offset);

        return {
            entries,
            total: countResult?.count ?? 0,
        };
    }

    /**
     * Returns per-agent monthly spend rollup for an org.
     * Used for the agent hierarchy cost attribution view.
     */
    async getAgentMonthlySummaries(
        orgId: number,
        year: number,
        month: number, // 1-12
    ): Promise<AgentMonthlySummary[]> {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 1);

        const rows = await db
            .select({
                agentDeploymentId: costLedger.agentDeploymentId,
                totalCostUsd: sql<number>`SUM(cost_usd::numeric)`,
                totalTokensPrompt: sql<number>`SUM(tokens_prompt)`,
                totalTokensCompletion: sql<number>`SUM(tokens_completion)`,
                callCount: sql<number>`COUNT(*)::int`,
            })
            .from(costLedger)
            .where(
                and(
                    eq(costLedger.orgId, orgId),
                    gte(costLedger.recordedAt, startDate),
                    lte(costLedger.recordedAt, endDate),
                )
            )
            .groupBy(costLedger.agentDeploymentId);

        return rows.map((r) => ({
            agentDeploymentId: r.agentDeploymentId ?? null,
            totalCostUsd: Number(r.totalCostUsd ?? 0),
            totalTokensPrompt: Number(r.totalTokensPrompt ?? 0),
            totalTokensCompletion: Number(r.totalTokensCompletion ?? 0),
            callCount: Number(r.callCount ?? 0),
        }));
    }

    /**
     * Returns the current month's total spend for a specific agent deployment.
     */
    async getAgentCurrentMonthSpend(
        agentDeploymentId: number,
    ): Promise<number> {
        const now = new Date();
        const startDate = new Date(now.getFullYear(), now.getMonth(), 1);

        const [row] = await db
            .select({
                total: sql<number>`COALESCE(SUM(cost_usd::numeric), 0)`,
            })
            .from(costLedger)
            .where(
                and(
                    eq(costLedger.agentDeploymentId, agentDeploymentId),
                    gte(costLedger.recordedAt, startDate),
                )
            );

        return Number(row?.total ?? 0);
    }
}

export const costLedgerService = new CostLedgerService();
