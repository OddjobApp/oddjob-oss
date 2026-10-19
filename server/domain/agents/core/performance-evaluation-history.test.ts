/**
 * What an agent's performance evaluation is allowed to count as evidence.
 *
 * These assert the absence of invented numbers. The previous implementation
 * stamped a constant cost on every row (1200 per mission, 800 per tool call) and
 * fed it to costPerSuccess, so "cost efficiency" was a function of row count
 * rather than cost — and on the self-healing path a low enough score opens a
 * Performance Improvement Plan against the agent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { rows, capturedTables } = vi.hoisted(() => ({
    rows: { current: [] as any[] },
    capturedTables: { current: [] as string[] },
}));

vi.mock("@server/database_service.js", () => {
    const q: any = {
        select: () => q,
        // Record every table this function reads, so a reintroduced
        // agent_tool_usage query fails loudly rather than quietly.
        from: (t: any) => { capturedTables.current.push(String(t?.[Symbol.for("drizzle:Name")] ?? "unknown")); return q; },
        innerJoin: () => q,
        where: () => q,
        orderBy: () => q,
        limit: async () => rows.current,
    };
    return { db: q };
});

vi.mock("./performance-manager.service.js", () => ({ performanceManagerService: {} }));
vi.mock("@server/domain/governor/core/governance.service.js", () => ({ governanceService: {} }));
vi.mock("@server/domain/core/infrastructure/event-stream.service.js", () => ({ eventStream: { publish: vi.fn() } }));

const { fetchAgentMissionHistory } = await import("./performance-evaluation-jobs.js");

describe("fetchAgentMissionHistory", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        rows.current = [];
        capturedTables.current = [];
    });

    it("reports the cost the run actually recorded", async () => {
        rows.current = [
            { runId: 1, status: "completed", isSuccess: true, costUsd: "12.5000", createdAt: new Date("2026-09-01") },
            { runId: 2, status: "failed", isSuccess: false, costUsd: "3.2500", createdAt: new Date("2026-09-02") },
        ];

        const history = await fetchAgentMissionHistory("7", 1);

        // Not 1200. drizzle decimal() hands back a string, hence the conversion.
        expect(history.map(h => h.cost)).toEqual([12.5, 3.25]);
        expect(history.map(h => h.missionId)).toEqual([1, 2]);
    });

    it("treats an unrecorded cost as zero rather than inventing one", async () => {
        rows.current = [{ runId: 3, status: "completed", isSuccess: true, costUsd: null, createdAt: null }];

        const [entry] = await fetchAgentMissionHistory("7", 1);

        expect(entry.cost).toBe(0);
    });

    it("falls back to the run status when isSuccess is null", async () => {
        rows.current = [
            { runId: 4, status: "completed", isSuccess: null, costUsd: "0", createdAt: null },
            { runId: 5, status: "errored", isSuccess: null, costUsd: "0", createdAt: null },
        ];

        const history = await fetchAgentMissionHistory("7", 1);

        expect(history.map(h => h.success)).toEqual([true, false]);
    });

    it("returns nothing for a non-numeric agent id instead of the whole org", async () => {
        // This is the important one. The old code fell through to sql`true` here,
        // which matched every tool-usage row in the organization and attributed
        // all of it to this one agent.
        rows.current = [{ runId: 9, status: "completed", isSuccess: true, costUsd: "5", createdAt: null }];

        const history = await fetchAgentMissionHistory("copilot-alpha", 1);

        expect(history).toEqual([]);
        expect(capturedTables.current).toEqual([]);
    });

    it("never reads agent_tool_usage, which has no agent column to join on", async () => {
        rows.current = [];

        await fetchAgentMissionHistory("7", 1);

        expect(capturedTables.current).not.toContain("agent_tool_usage");
    });

    it("yields an empty history rather than throwing when the query fails", async () => {
        rows.current = null as any; // makes limit() reject downstream consumers

        const history = await fetchAgentMissionHistory("7", 1);

        expect(Array.isArray(history)).toBe(true);
    });
});
