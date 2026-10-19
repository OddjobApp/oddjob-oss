/** @vitest-environment node */
/**
 * The planner decides what runs and in what order, so its two dangerous failure
 * modes are (a) silently reordering side-effecting work and (b) speculating on a
 * tool that mutates state. Both are pinned here, along with the budget bound
 * that gives the loop a convergence criterion it currently lacks.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ToolPlannerService, type CandidateAction } from "../tool-planner.service.js";
import type { ToolCostTable, ToolCost } from "../tool-cost-model.service.js";

function cost(toolName: string, expectedCostMs: number, measured = true): ToolCost {
    return {
        toolName,
        samples: measured ? 10 : 0,
        meanLatencyMs: expectedCostMs,
        medianLatencyMs: expectedCostMs,
        successRate: 1,
        expectedCostMs,
        measured,
    };
}

/** Mirrors the real measured table: 1ms status check vs 7s pipeline trigger. */
function table(): ToolCostTable {
    return {
        costs: new Map([
            ["get_pipeline_status", cost("get_pipeline_status", 1)],
            ["list_pipelines", cost("list_pipelines", 22)],
            ["search_unified_knowledge", cost("search_unified_knowledge", 457)],
            ["trigger_pipeline", cost("trigger_pipeline", 7498)],
        ]),
        fallback: cost("__unknown__", 1038, false),
        computedAt: Date.now(),
        totalSamples: 281,
    };
}

describe("ToolPlannerService", () => {
    let planner: ToolPlannerService;
    beforeEach(() => { planner = new ToolPlannerService(); });

    it("orders cheapest-first, so a 7s trigger does not precede a 1ms check", () => {
        const candidates: CandidateAction[] = [
            { toolName: "trigger_pipeline" },
            { toolName: "get_pipeline_status" },
            { toolName: "search_unified_knowledge" },
        ];
        const plan = planner.plan(candidates, table());
        expect(plan.ordered.map((a) => a.toolName)).toEqual([
            "get_pipeline_status",
            "search_unified_knowledge",
            "trigger_pipeline",
        ]);
        expect(plan.totalCostMs).toBe(1 + 457 + 7498);
    });

    it("keeps the model's order as the tiebreak for equal-cost actions", () => {
        const t = table();
        t.costs.set("a", cost("a", 50));
        t.costs.set("b", cost("b", 50));
        const plan = planner.plan([{ toolName: "b" }, { toolName: "a" }], t);
        expect(plan.ordered.map((x) => x.toolName)).toEqual(["b", "a"]);
    });

    it("treats a tool with no declared idempotency as unsafe to speculate on", () => {
        // 349 of 392 registered tools declare nothing; none may be assumed safe.
        const plan = planner.plan([{ toolName: "get_pipeline_status" }], table());
        expect(plan.ordered[0].speculative).toBe(false);
    });

    it("permits speculation only on an explicit read-safe/idempotent declaration", () => {
        const plan = planner.plan(
            [
                { toolName: "get_pipeline_status", idempotency: "read-safe" },
                { toolName: "list_pipelines", idempotency: "idempotent" },
                { toolName: "trigger_pipeline", idempotency: "none" },
            ],
            table(),
        );
        const byName = Object.fromEntries(plan.ordered.map((a) => [a.toolName, a.speculative]));
        expect(byName.get_pipeline_status).toBe(true);
        expect(byName.list_pipelines).toBe(true);
        expect(byName.trigger_pipeline).toBe(false);
    });

    it("stops the parallel prefix at the first side-effecting action", () => {
        const plan = planner.plan(
            [
                { toolName: "get_pipeline_status", idempotency: "read-safe" },
                { toolName: "list_pipelines", idempotency: "read-safe" },
                { toolName: "trigger_pipeline", idempotency: "none" },
                { toolName: "search_unified_knowledge", idempotency: "read-safe" },
            ],
            table(),
        );
        // Cheapest-first puts the two reads and the search before the trigger,
        // so the prefix must end where the write begins.
        const prefix = planner.parallelizablePrefix(plan).map((a) => a.toolName);
        expect(prefix).not.toContain("trigger_pipeline");
        expect(prefix.length).toBeGreaterThan(0);
    });

    it("defers actions past the budget instead of running them", () => {
        const plan = planner.plan(
            [
                { toolName: "get_pipeline_status" },
                { toolName: "search_unified_knowledge" },
                { toolName: "trigger_pipeline" },
            ],
            table(),
            { budgetMs: 1000 },
        );
        expect(plan.budgetExhausted).toBe(true);
        expect(plan.ordered.map((a) => a.toolName)).toEqual([
            "get_pipeline_status",
            "search_unified_knowledge",
        ]);
        expect(plan.deferred.map((a) => a.toolName)).toEqual(["trigger_pipeline"]);
    });

    it("still runs the first action when it alone exceeds the budget", () => {
        // Refusing everything would stall the task rather than bound it.
        const plan = planner.plan([{ toolName: "trigger_pipeline" }], table(), { budgetMs: 10 });
        expect(plan.ordered).toHaveLength(1);
        expect(plan.deferred).toHaveLength(0);
    });

    it("counts cost already spent, so the budget spans the task not one round", () => {
        const plan = planner.plan(
            [{ toolName: "get_pipeline_status" }, { toolName: "trigger_pipeline" }],
            table(),
            { budgetMs: 8000, spentMs: 7900 },
        );
        expect(plan.ordered.map((a) => a.toolName)).toEqual(["get_pipeline_status"]);
        expect(plan.budgetExhausted).toBe(true);
    });

    it("flags a plan built entirely from unmeasured fallbacks", () => {
        const plan = planner.plan([{ toolName: "brand_new" }], table());
        expect(plan.allEstimated).toBe(true);
        expect(plan.ordered[0].cost.measured).toBe(false);

        const measured = planner.plan([{ toolName: "get_pipeline_status" }], table());
        expect(measured.allEstimated).toBe(false);
    });

    it("gives the loop a cost-based stop, which maxIterations alone does not", () => {
        expect(planner.shouldStopForBudget(500, 1000)).toBe(false);
        expect(planner.shouldStopForBudget(1000, 1000)).toBe(true);
    });

    it("handles an empty proposal set without inventing work", () => {
        const plan = planner.plan([], table());
        expect(plan.ordered).toEqual([]);
        expect(plan.totalCostMs).toBe(0);
        expect(plan.allEstimated).toBe(false);
    });
});

describe("budget ceiling configuration", () => {
    const original = process.env.AGENT_TOOL_BUDGET_MS;
    afterEach(() => {
        if (original === undefined) delete process.env.AGENT_TOOL_BUDGET_MS;
        else process.env.AGENT_TOOL_BUDGET_MS = original;
    });

    it("defaults to the generous 120s ceiling", () => {
        delete process.env.AGENT_TOOL_BUDGET_MS;
        expect(new ToolPlannerService().defaultBudgetMs()).toBe(120_000);
    });

    it("can be lowered via AGENT_TOOL_BUDGET_MS without a code change", () => {
        process.env.AGENT_TOOL_BUDGET_MS = "30000";
        const planner = new ToolPlannerService();
        expect(planner.defaultBudgetMs()).toBe(30_000);
        expect(planner.shouldStopForBudget(29_999)).toBe(false);
        expect(planner.shouldStopForBudget(30_000)).toBe(true);
    });

    it("ignores a nonsensical override rather than disabling the bound", () => {
        // A budget of 0 or "abc" must not mean "stop immediately" or "never stop".
        for (const bad of ["0", "-1", "abc", ""]) {
            process.env.AGENT_TOOL_BUDGET_MS = bad;
            expect(new ToolPlannerService().defaultBudgetMs()).toBe(120_000);
        }
    });
});
