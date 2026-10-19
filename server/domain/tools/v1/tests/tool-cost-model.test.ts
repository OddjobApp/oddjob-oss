/** @vitest-environment node */
/**
 * The cost model is the part of ToolChain* planning that can be wrong quietly:
 * if it returns plausible-looking numbers that aren't grounded in history, the
 * planner still produces confident-looking plans. These tests pin the arithmetic
 * and the fallback behaviour rather than just checking it returns something.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const rows: any[] = [];

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => ({
                    groupBy: async () => rows,
                }),
            }),
        }),
    },
}));

const { ToolCostModelService } = await import("../tool-cost-model.service.js");

function setRows(next: any[]) {
    rows.length = 0;
    rows.push(...next);
}

describe("ToolCostModelService", () => {
    let service: InstanceType<typeof ToolCostModelService>;

    beforeEach(() => {
        service = new ToolCostModelService();
        setRows([]);
    });

    it("prices a reliable fast tool far below a slow one", async () => {
        setRows([
            { toolName: "get_pipeline_status", samples: 17, successes: 17, meanMs: 2, medianMs: 2 },
            { toolName: "trigger_pipeline", samples: 17, successes: 16, meanMs: 51056, medianMs: 51056 },
        ]);
        const table = await service.getCostTable(null);

        const fast = service.costOf(table, "get_pipeline_status");
        const slow = service.costOf(table, "trigger_pipeline");
        expect(slow.expectedCostMs).toBeGreaterThan(fast.expectedCostMs * 1000);
        expect(fast.measured).toBe(true);
    });

    it("charges an unreliable tool for its expected retries", async () => {
        // 45/97 success: roughly two attempts per success, so ~2x its latency.
        setRows([
            { toolName: "show_pipeline_input_form", samples: 97, successes: 45, meanMs: 165, medianMs: 165 },
        ]);
        const table = await service.getCostTable(null);
        const cost = service.costOf(table, "show_pipeline_input_form");

        expect(cost.successRate).toBeCloseTo(45 / 97, 2);
        // Median 165ms at ~2.16 attempts.
        expect(cost.expectedCostMs).toBeGreaterThan(300);
        expect(cost.expectedCostMs).toBeLessThan(400);
    });

    it("uses the median, so one outlier cannot dominate a tool's price", async () => {
        setRows([
            { toolName: "browse_web", samples: 7, successes: 7, meanMs: 9000, medianMs: 6 },
        ]);
        const table = await service.getCostTable(null);
        const cost = service.costOf(table, "browse_web");
        // Mean is wrecked by an outlier; the planner should see the median.
        expect(cost.meanLatencyMs).toBe(9000);
        expect(cost.expectedCostMs).toBeLessThan(20);
    });

    it("shrinks a thin sample toward the prior instead of trusting it", async () => {
        // One failed call must not price the tool as 0% reliable.
        setRows([{ toolName: "flaky_once", samples: 1, successes: 0, meanMs: 100, medianMs: 100 }]);
        const table = await service.getCostTable(null);
        const cost = service.costOf(table, "flaky_once");

        expect(cost.successRate).toBeGreaterThan(0.5);
        expect(cost.successRate).toBeLessThan(0.8);
    });

    it("falls back for a tool with no history, and marks it unmeasured", async () => {
        setRows([{ toolName: "known", samples: 10, successes: 10, meanMs: 100, medianMs: 100 }]);
        const table = await service.getCostTable(null);

        const unknown = service.costOf(table, "never_seen");
        expect(unknown.measured).toBe(false);
        expect(unknown.toolName).toBe("never_seen");
        expect(unknown.expectedCostMs).toBeGreaterThan(0);
    });

    it("keeps expected cost finite when a tool always fails", async () => {
        setRows([{ toolName: "always_fails", samples: 50, successes: 0, meanMs: 100, medianMs: 100 }]);
        const table = await service.getCostTable(null);
        const cost = service.costOf(table, "always_fails");

        expect(Number.isFinite(cost.expectedCostMs)).toBe(true);
        expect(cost.expectedCostMs).toBe(400); // capped at 4 attempts
    });

    it("sums a candidate sequence, which is the planner's g(n)", async () => {
        setRows([
            { toolName: "a", samples: 10, successes: 10, meanMs: 100, medianMs: 100 },
            { toolName: "b", samples: 10, successes: 10, meanMs: 250, medianMs: 250 },
        ]);
        const table = await service.getCostTable(null);
        expect(service.sequenceCost(table, ["a", "b"])).toBe(350);
        expect(service.sequenceCost(table, [])).toBe(0);
    });

    it("serves a cached table rather than re-querying", async () => {
        setRows([{ toolName: "a", samples: 10, successes: 10, meanMs: 100, medianMs: 100 }]);
        const first = await service.getCostTable(null);
        setRows([]); // any re-query would now produce an empty table
        const second = await service.getCostTable(null);
        expect(second.computedAt).toBe(first.computedAt);

        service.invalidate();
        const third = await service.getCostTable(null);
        expect(third.costs.size).toBe(0);
    });
});
