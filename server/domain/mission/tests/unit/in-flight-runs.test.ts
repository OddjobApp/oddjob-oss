import { describe, expect, it } from "vitest";
import {
    describeTraceEntry,
    isInFlightStatus,
    toInFlightRun,
    STALE_AFTER_MS,
    type InFlightRunRow,
} from "../../core/in-flight-runs.js";

describe("in-flight-runs mapper", () => {
    const baseRow: InFlightRunRow = {
        id: 101,
        missionId: 42,
        name: "Security Audit Run",
        status: "active",
        costUsd: "1.25",
        budgetLimitUsd: "10.00",
        lastTraceEntry: { event: "tool_completed", tool: "code_analyzer" },
        lastCheckpointAt: new Date("2026-10-07T12:00:00Z"),
        updatedAt: new Date("2026-10-07T12:00:00Z"),
    };

    it("maps an active run with authentic telemetry and no fabricated numbers", () => {
        const now = new Date("2026-10-07T12:05:00Z").getTime();
        const run = toInFlightRun(baseRow, now);

        expect(run).not.toBeNull();
        expect(run).toEqual({
            runId: 101,
            missionId: 42,
            name: "Security Audit Run",
            status: "active",
            costUsd: 1.25,
            budgetLimitUsd: 10,
            lastEvent: "tool completed · code_analyzer",
            lastActivityAt: "2026-10-07T12:00:00.000Z",
            stale: false,
        });
    });

    it("returns null for non in-flight statuses (e.g. completed, failed)", () => {
        expect(isInFlightStatus("completed")).toBe(false);
        expect(isInFlightStatus("failed")).toBe(false);
        expect(toInFlightRun({ ...baseRow, status: "completed" })).toBeNull();
        expect(toInFlightRun({ ...baseRow, status: "failed" })).toBeNull();
    });

    it("accepts paused, waiting_on_human, and waiting_on_file as in-flight statuses", () => {
        expect(isInFlightStatus("paused")).toBe(true);
        expect(isInFlightStatus("waiting_on_human")).toBe(true);
        expect(isInFlightStatus("waiting_on_file")).toBe(true);

        const paused = toInFlightRun({ ...baseRow, status: "paused" });
        expect(paused?.status).toBe("paused");
        expect(paused?.stale).toBe(false);
    });

    it("flags an active run as stale when inactive past the threshold", () => {
        const baseTime = new Date("2026-10-07T12:00:00Z").getTime();
        const staleTime = baseTime + STALE_AFTER_MS + 1000;
        const run = toInFlightRun(baseRow, staleTime);

        expect(run?.stale).toBe(true);
    });

    it("does not flag paused or waiting runs as stale even after prolonged inactivity", () => {
        const baseTime = new Date("2026-10-07T12:00:00Z").getTime();
        const wayLater = baseTime + STALE_AFTER_MS * 10;

        const paused = toInFlightRun({ ...baseRow, status: "paused" }, wayLater);
        const waiting = toInFlightRun({ ...baseRow, status: "waiting_on_human" }, wayLater);

        expect(paused?.stale).toBe(false);
        expect(waiting?.stale).toBe(false);
    });

    it("preserves null cost and budget when not recorded instead of defaulting to 0.42 or 5.00", () => {
        const rowWithNoSpend: InFlightRunRow = {
            ...baseRow,
            costUsd: null,
            budgetLimitUsd: null,
            lastTraceEntry: null,
        };
        const run = toInFlightRun(rowWithNoSpend);

        expect(run?.costUsd).toBeNull();
        expect(run?.budgetLimitUsd).toBeNull();
        expect(run?.lastEvent).toBeNull();
    });

    it("extracts meaningful trace events without fabricating commentary", () => {
        expect(describeTraceEntry(null)).toBeNull();
        expect(describeTraceEntry("raw string")).toBeNull();
        expect(describeTraceEntry({})).toBeNull();
        expect(describeTraceEntry({ event: "checkpoint_saved" })).toBe("checkpoint saved");
        expect(describeTraceEntry({ tool: "web_search" })).toBe("web_search");
        expect(describeTraceEntry({ type: "agent_thought", tool: "reason" })).toBe("agent thought · reason");
    });
});
