import { describe, expect, it } from "vitest";
import {
    assessEvaluationPromotion,
    summarizeEvaluationRun,
} from "./evaluation-promotion.service.js";

describe("evaluation promotion assessment", () => {
    it("summarizes a completed evaluation run", () => {
        expect(summarizeEvaluationRun(
            { id: 7, status: "completed" },
            [{ passed: true }, { passed: true }, { passed: false }],
        )).toEqual({
            runId: 7,
            status: "completed",
            total: 3,
            passed: 2,
            failed: 1,
            passRate: 66.67,
        });
    });

    it("allows a first baseline when thresholds pass", () => {
        const result = assessEvaluationPromotion({
            candidate: { runId: 2, status: "completed", total: 10, passed: 9, failed: 1, passRate: 90 },
        });
        expect(result.ready).toBe(true);
        expect(result.checks.at(-1)?.status).toBe("warning");
    });

    it("blocks incomplete and empty runs", () => {
        const result = assessEvaluationPromotion({
            candidate: { runId: 2, status: "running", total: 0, passed: 0, failed: 0, passRate: 0 },
        });
        expect(result.ready).toBe(false);
        expect(result.checks.filter((check) => check.status === "block")).toHaveLength(3);
    });

    it("blocks a candidate that regresses beyond the allowed budget", () => {
        const result = assessEvaluationPromotion({
            candidate: { runId: 3, status: "completed", total: 20, passed: 18, failed: 2, passRate: 90 },
            baseline: { runId: 2, status: "completed", total: 20, passed: 20, failed: 0, passRate: 100 },
        });
        expect(result.ready).toBe(false);
        expect(result.passRateDelta).toBe(-10);
    });

    it("accepts stricter caller-provided thresholds", () => {
        const result = assessEvaluationPromotion({
            candidate: { runId: 3, status: "completed", total: 10, passed: 9, failed: 1, passRate: 90 },
            thresholds: { minimumPassRate: 95 },
        });
        expect(result.ready).toBe(false);
    });
});
