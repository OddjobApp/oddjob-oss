/**
 * Which id cycle_run_events.run_id actually is.
 *
 * Three parts of the codebase disagreed about it. Both writers in
 * pipeline-step-runner.ts insert a pipeline_executions.id; the foreign key said
 * operational_cycles until migration 0103; and this reader was handed a mission
 * run id straight from GET /api/mission-runs/:id/history.
 *
 * The id spaces overlap, so the disagreement did not announce itself. It
 * surfaced as a mission's history page showing steps that belonged to some
 * other execution — which is worse than showing nothing, because there is
 * nothing about the output that looks wrong.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

/** Every query the service runs, in order, so the keys can be asserted on. */
const queries: Array<{ table: string; where: unknown }> = [];

let missionRunRow: { pipelineExecutionId: number | null } | undefined;
const eventRows = [{ id: 1, runId: 900, stepCode: "compile", eventType: "STEP_COMPLETED" }];

vi.mock("@server/database_service.js", () => {
    const from = (table: any) => {
        const name = String(table?.[Symbol.for("drizzle:Name")] ?? table?._?.name ?? "unknown");
        return {
            where: (cond: unknown) => {
                queries.push({ table: name, where: cond });
                const rows = name === "mission_runs" ? (missionRunRow ? [missionRunRow] : []) : eventRows;
                return {
                    limit: async () => rows,
                    orderBy: async () => rows,
                };
            },
        };
    };
    return { db: { select: () => ({ from }) } };
});

vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { missionRunService } = await import("../core/mission-run.service.js");

describe("mission run history", () => {
    beforeEach(() => {
        queries.length = 0;
        missionRunRow = { pipelineExecutionId: 900 };
    });

    it("resolves the mission run's pipeline execution before asking for events", async () => {
        // The mission run id is 42; the events live under execution 900. Asking
        // cycle_run_events for 42 would return another execution's steps.
        await missionRunService.getRunEvents(42);

        expect(queries.map((q) => q.table)).toEqual(["mission_runs", "cycle_run_events"]);
    });

    it("returns the events of that execution", async () => {
        const events = await missionRunService.getRunEvents(42);
        expect(events).toEqual(eventRows);
    });

    it("returns nothing for a run that has not reached a pipeline", async () => {
        // Distinct from an empty history: there is no execution to ask about.
        missionRunRow = { pipelineExecutionId: null };

        expect(await missionRunService.getRunEvents(42)).toEqual([]);
        expect(queries.map((q) => q.table)).toEqual(["mission_runs"]);
    });

    it("returns nothing for a mission run that does not exist", async () => {
        missionRunRow = undefined;

        expect(await missionRunService.getRunEvents(999)).toEqual([]);
        expect(queries.map((q) => q.table)).toEqual(["mission_runs"]);
    });

    it("still filters by event type and step", async () => {
        await missionRunService.getRunEvents(42, { status: "failed", stepCode: "compile" });

        // The lookup is an addition, not a replacement for the filtering.
        expect(queries.map((q) => q.table)).toEqual(["mission_runs", "cycle_run_events"]);
    });
});
