import { describe, it, expect, vi, afterEach } from "vitest";
import { dashboardService } from "@server/domain/admin/core/dashboard.service.js";
import { dailyBriefService } from "@server/domain/admin/core/daily-brief.service.js";

const orgContext = { isSuperAdmin: false, organizationId: 291 };

/**
 * Unit tests for the Copilot daily brief. We stub the dashboard aggregations and
 * the approvals count (spying on the object methods) so these run fast in CI with
 * no DB — the point is the composition + resilience logic, not the queries.
 */
function stubDashboard(overrides: { stats?: any; cost?: any; insights?: any[] } = {}) {
    vi.spyOn(dashboardService, "getDashboardStats").mockResolvedValue({
        activeSchedules: 3, failedJobs24h: 0, activeAlerts: 0, activePipelines: 12,
        activeWorkstreams: 4, pipelineRuns24h: 7, failedPipelines24h: 0,
        recentExecutions: [{ jobName: "Build", status: "success" }],
        activeAlertList: [], executionTrend: [],
        ...overrides.stats,
    } as any);
    vi.spyOn(dashboardService, "getCostDashboardStats").mockResolvedValue({
        totalSpend: 35.5,
        orgBudget: { monthlyBudget: 250, currentMonthSpend: 0.49, resetDay: 1, lastResetAt: null },
        activeMissions: [], dailyCosts: [], modelCosts: [], topPipelines: [], topAgents: [], spendHistory: [], insights: [],
        ...overrides.cost,
    } as any);
    vi.spyOn(dashboardService, "getDashboardInsights").mockResolvedValue((overrides.insights ?? []) as any);
}

describe("dailyBriefService.getDailyBrief", () => {
    afterEach(() => vi.restoreAllMocks());

    it("composes every section from the real aggregations", async () => {
        stubDashboard();
        vi.spyOn(dailyBriefService, "countPendingApprovals").mockResolvedValue(0);

        const { markdown, generatedAt } = await dailyBriefService.getDailyBrief(orgContext);

        expect(markdown).toContain("Oddjob Daily Brief");
        expect(markdown).toContain("### Active work");
        expect(markdown).toContain("**12** active pipelines");
        expect(markdown).toContain("**7** pipeline runs in the last 24h");
        expect(markdown).toContain("### Decisions needed");
        expect(markdown).toContain("Nothing is waiting on you");
        expect(markdown).toContain("### Risks");
        expect(markdown).toContain("### Spend");
        expect(markdown).toContain("$35.50");
        expect(markdown).toContain("$0.49");
        expect(markdown).toContain("of **$250.00** budget");
        expect(markdown).toContain("### Recommended next steps");
        expect(new Date(generatedAt).toString()).not.toBe("Invalid Date");
    });

    it("surfaces pending approvals and alerts as decisions + next steps", async () => {
        stubDashboard({ stats: { activeAlerts: 2 } });
        vi.spyOn(dailyBriefService, "countPendingApprovals").mockResolvedValue(3);

        const { markdown } = await dailyBriefService.getDailyBrief(orgContext);

        expect(markdown).toContain("**3** governance approval(s) awaiting a decision");
        expect(markdown).toContain("**2** unacknowledged alert(s)");
        expect(markdown).toContain("Review 3 pending governance approval(s).");
        expect(markdown).not.toContain("Nothing is waiting on you");
    });

    it("renders warning insights and failure counts under Risks", async () => {
        stubDashboard({
            stats: { failedJobs24h: 5, failedPipelines24h: 1 },
            insights: [{ id: "x", type: "warning", title: "High Failure Rate", description: "Activity \"X\" failed 5 times." }],
        });
        vi.spyOn(dailyBriefService, "countPendingApprovals").mockResolvedValue(0);

        const { markdown } = await dailyBriefService.getDailyBrief(orgContext);

        expect(markdown).toContain("**5** activity failure(s)");
        expect(markdown).toContain("High Failure Rate");
        expect(markdown).toContain("Investigate 5 recent activity failure(s).");
    });

    it("flags missions that are over budget", async () => {
        stubDashboard({ cost: { activeMissions: [{ id: 1, name: "M", budgetLimit: 100, currentSpend: 140 }] } });
        vi.spyOn(dailyBriefService, "countPendingApprovals").mockResolvedValue(0);

        const { markdown } = await dailyBriefService.getDailyBrief(orgContext);
        expect(markdown).toContain("mission(s) over budget");
    });

    it("degrades to a partial brief when a data source throws (never rejects)", async () => {
        vi.spyOn(dashboardService, "getDashboardStats").mockRejectedValue(new Error("db down"));
        vi.spyOn(dashboardService, "getCostDashboardStats").mockRejectedValue(new Error("db down"));
        vi.spyOn(dashboardService, "getDashboardInsights").mockRejectedValue(new Error("db down"));
        vi.spyOn(dailyBriefService, "countPendingApprovals").mockRejectedValue(new Error("db down"));

        const { markdown } = await dailyBriefService.getDailyBrief(orgContext);

        expect(markdown).toContain("Oddjob Daily Brief");
        expect(markdown).toContain("Activity metrics are unavailable");
        expect(markdown).toContain("Spend metrics are unavailable");
        expect(markdown).toContain("Nothing is waiting on you");
    });
});
