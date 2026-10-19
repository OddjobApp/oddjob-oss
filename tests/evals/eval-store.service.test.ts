import { describe, it, expect, beforeEach, vi } from "vitest";

const { insertMock, valuesMock, returningMock } = vi.hoisted(() => {
    const returningMock = vi.fn().mockResolvedValue([{ id: 7 }]);
    const valuesMock = vi.fn(() => ({ returning: returningMock }));
    const insertMock = vi.fn(() => ({ values: valuesMock }));
    return { insertMock, valuesMock, returningMock };
});

vi.mock("@server/database_service.js", () => ({ db: { insert: insertMock } }));
vi.mock("@shared/schema/index.js", () => ({ evalRuns: { _: "runs" }, evalResults: { _: "results" } }));

import { evalStoreService } from "../../server/domain/ai/core/eval-store.service.js";
import type { ScenarioResult } from "./scoring.js";

const result = (over: Partial<ScenarioResult> = {}): ScenarioResult => ({
    scenarioId: "s1",
    subject: { kind: "capability", ref: "write_file" },
    subjectKey: "capability:write_file",
    repeats: 1,
    passRate: 0.75,
    threshold: 0.8,
    passed: false,
    variance: 0,
    repeatOutcomes: [],
    ...over,
});

describe("evalStoreService.recordRun", () => {
    beforeEach(() => vi.clearAllMocks());

    it("inserts a run then the results and returns the run id", async () => {
        const id = await evalStoreService.recordRun({
            commitSha: "abc123",
            results: [result({ passed: true, passRate: 1 }), result({ scenarioId: "s2" })],
        });
        expect(id).toBe(7);
        expect(insertMock).toHaveBeenCalledTimes(2); // run + results
        const runValues = valuesMock.mock.calls[0][0] as any;
        expect(runValues.totalScenarios).toBe(2);
        expect(runValues.passedScenarios).toBe(1);
        // decimals serialized as fixed strings
        const rows = valuesMock.mock.calls[1][0] as any[];
        expect(rows[0].passRate).toBe("1.0000");
        expect(rows[0].subjectKey).toBe("capability:write_file");
    });

    it("returns null (never throws) when the DB write fails", async () => {
        returningMock.mockRejectedValueOnce(new Error("db down"));
        const id = await evalStoreService.recordRun({ results: [result()] });
        expect(id).toBeNull();
    });

    it("skips the results insert when there are no results", async () => {
        await evalStoreService.recordRun({ results: [] });
        expect(insertMock).toHaveBeenCalledTimes(1); // run only
    });
});
