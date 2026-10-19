import { db } from "@server/database_service.js";
import { governanceApprovals } from "@shared/schema/index.js";
import { and, eq, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { dashboardService } from "./dashboard.service.js";

const logger = createLogger("DailyBriefService");

type OrgContext = { isSuperAdmin: boolean; organizationId: number | null };

/**
 * Deterministic "Daily Brief" for the Copilot. Composes real platform data from
 * the existing dashboard aggregations (stats / cost / insights) plus pending
 * governance approvals — no LLM call, so it can't hallucinate or fail on model
 * quota/timeouts. Every source is guarded so a single failing query degrades to
 * a partial brief instead of erroring the whole thing.
 */
export const dailyBriefService = {
    async getDailyBrief(orgContext: OrgContext): Promise<{ markdown: string; generatedAt: string }> {
        const [stats, cost, insights, pendingApprovals] = await Promise.all([
            dashboardService.getDashboardStats(orgContext).catch((err: any) => {
                logger.warn(`[DailyBrief] stats query failed: ${err?.message}`); return null;
            }),
            dashboardService.getCostDashboardStats(orgContext).catch((err: any) => {
                logger.warn(`[DailyBrief] cost query failed: ${err?.message}`); return null;
            }),
            dashboardService.getDashboardInsights(orgContext).catch((err: any) => {
                logger.warn(`[DailyBrief] insights query failed: ${err?.message}`); return [] as any[];
            }),
            this.countPendingApprovals(orgContext).catch((err: any) => {
                logger.warn(`[DailyBrief] approvals query failed: ${err?.message}`); return 0;
            }),
        ]);

        const lines: string[] = [];
        lines.push("## ☀️ Oddjob Daily Brief");
        lines.push(`_Generated ${new Date().toLocaleString()} — live platform data._`);

        // ─── Active work ─────────────────────────────────────────────────────
        lines.push("\n### Active work");
        if (stats) {
            lines.push(`- **${stats.activePipelines}** active pipelines · **${stats.activeSchedules}** active schedules`);
            lines.push(`- **${stats.pipelineRuns24h}** pipeline runs in the last 24h · **${stats.activeWorkstreams}** new knowledge workstreams`);
            if (stats.recentExecutions?.length) {
                const latest = stats.recentExecutions.slice(0, 3).map((r: any) => `${r.jobName} (${r.status})`).join(", ");
                lines.push(`- Latest activity: ${latest}`);
            }
        } else {
            lines.push("- _Activity metrics are unavailable right now._");
        }

        // ─── Decisions needed ────────────────────────────────────────────────
        lines.push("\n### Decisions needed");
        const decisionLines: string[] = [];
        if (pendingApprovals > 0) decisionLines.push(`- **${pendingApprovals}** governance approval(s) awaiting a decision`);
        if (stats?.activeAlerts) decisionLines.push(`- **${stats.activeAlerts}** unacknowledged alert(s)`);
        if (decisionLines.length) lines.push(...decisionLines);
        else lines.push("- Nothing is waiting on you. ✅");

        // ─── Risks ───────────────────────────────────────────────────────────
        lines.push("\n### Risks");
        const riskInsights = (insights || []).filter((i: any) => i.type === "warning");
        const riskLines: string[] = [];
        if (stats?.failedJobs24h || stats?.failedPipelines24h) {
            riskLines.push(`- **${stats.failedJobs24h}** activity failure(s) and **${stats.failedPipelines24h}** failed pipeline run(s) in 24h`);
        }
        for (const i of riskInsights.slice(0, 5)) riskLines.push(`- ⚠️ **${i.title}** — ${i.description}`);
        if (riskLines.length) lines.push(...riskLines);
        else lines.push("- No elevated risk signals. ✅");

        // ─── Spend ───────────────────────────────────────────────────────────
        lines.push("\n### Spend");
        if (cost) {
            lines.push(`- **$${cost.totalSpend.toFixed(2)}** AI spend (last 30 days)`);
            if (cost.orgBudget) {
                lines.push(`- Month-to-date: **$${cost.orgBudget.currentMonthSpend.toFixed(2)}** of **$${cost.orgBudget.monthlyBudget.toFixed(2)}** budget`);
            }
            const overBudget = (cost.activeMissions || []).filter((m: any) => m.budgetLimit > 0 && m.currentSpend > m.budgetLimit);
            if (overBudget.length) lines.push(`- ⚠️ **${overBudget.length}** mission(s) over budget`);
        } else {
            lines.push("- _Spend metrics are unavailable right now._");
        }

        // ─── Recommended next steps ──────────────────────────────────────────
        lines.push("\n### Recommended next steps");
        const recs: string[] = [];
        if (pendingApprovals > 0) recs.push(`Review ${pendingApprovals} pending governance approval(s).`);
        if (stats?.failedJobs24h) recs.push(`Investigate ${stats.failedJobs24h} recent activity failure(s).`);
        if (stats?.activeAlerts) recs.push(`Acknowledge or resolve ${stats.activeAlerts} open alert(s).`);
        for (const i of (insights || []).filter((i: any) => i.type === "optimization").slice(0, 2)) recs.push(i.description);
        if (!recs.length) recs.push("All clear — consider planning the next governed piece of work.");
        recs.forEach((r, i) => lines.push(`${i + 1}. ${r}`));

        return { markdown: lines.join("\n"), generatedAt: new Date().toISOString() };
    },

    /** Count governance approvals still awaiting a human decision, org-scoped. */
    async countPendingApprovals(orgContext: OrgContext): Promise<number> {
        const conditions = [eq(governanceApprovals.status, "pending")];
        if (!orgContext.isSuperAdmin && orgContext.organizationId !== null) {
            conditions.push(eq(governanceApprovals.organizationId, orgContext.organizationId));
        }
        const [row] = await db
            .select({ count: sql<number>`count(*)` })
            .from(governanceApprovals)
            .where(and(...conditions));
        return Number(row?.count || 0);
    },
};
