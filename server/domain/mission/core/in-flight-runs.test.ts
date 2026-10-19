// @vitest-environment node
import { describe, expect, it } from "vitest";
import { STALE_AFTER_MS, toInFlightRun, type InFlightRunRow } from "./in-flight-runs";

const now = Date.parse("2026-10-07T12:00:00Z");
const row: InFlightRunRow = {
    id: 73, missionId: 12, name: "Research", status: "active",
    costUsd: "0", budgetLimitUsd: null, lastTraceEntry: null,
    updatedAt: new Date(now), lastCheckpointAt: null,
};

describe("flight deck run evidence", () => {
    it("preserves zero spend and missing telemetry without fabricating values", () => {
        expect(toInFlightRun(row, now)).toMatchObject({ runId: 73, costUsd: 0, budgetLimitUsd: null, lastEvent: null, stale: false });
    });

    it("marks an active run stale when both activity timestamps have aged", () => {
        expect(toInFlightRun({ ...row, updatedAt: new Date(now - STALE_AFTER_MS - 1) }, now)?.stale).toBe(true);
    });

    it("uses a recent checkpoint as evidence of activity", () => {
        expect(toInFlightRun({ ...row, updatedAt: new Date(0), lastCheckpointAt: new Date(now) }, now)?.stale).toBe(false);
    });

    it.each(["paused", "waiting_on_human", "waiting_on_file"])("does not mistake %s for a zombie", (status) => {
        expect(toInFlightRun({ ...row, status, updatedAt: new Date(0) }, now)?.stale).toBe(false);
    });

    it.each(["completed", "failed", "cancelled"])("excludes %s runs", (status) => {
        expect(toInFlightRun({ ...row, status }, now)).toBeNull();
    });
});
