import { describe, it, expect } from "vitest";

import { GoodQuestionEngine } from "./good-question-engine.js";
import type { TrajectoryEvaluationResult } from "./prediction-engine.service.js";

function makeEvaluation(overrides: Partial<TrajectoryEvaluationResult> = {}): TrajectoryEvaluationResult {
    return {
        safeTransitionScore: 0.9,
        blastRadius: 0.2,
        probabilitySuccess: 0.7,
        reason: "approval required",
        recommendedAction: "require_approval",
        ...overrides,
    } as TrajectoryEvaluationResult;
}

describe("GoodQuestionEngine.generateStructuredQuestion", () => {
    // Regression: `riskScore` was derived inline twice with opposite polarities —
    // `1 - safeTransitionScore` for strategy selection, bare `safeTransitionScore`
    // in the published proofContext. A safe transition therefore rendered to the
    // reviewer as high risk, and a dangerous one as low.
    it("publishes riskScore as the COMPLEMENT of safeTransitionScore", () => {
        const payload = GoodQuestionEngine.generateStructuredQuestion({
            stage: "Approve",
            targetNodeOrFile: "prod/db/schema.ts",
            evaluationResult: makeEvaluation({ safeTransitionScore: 0.9 }),
        });

        expect(payload.proofContext.riskScore).toBeCloseTo(0.1, 5);
    });

    it("reports a dangerous transition as high risk", () => {
        const payload = GoodQuestionEngine.generateStructuredQuestion({
            stage: "Approve",
            targetNodeOrFile: "prod/db/schema.ts",
            evaluationResult: makeEvaluation({ safeTransitionScore: 0.0 }),
        });

        expect(payload.proofContext.riskScore).toBeCloseTo(1, 5);
    });

    it("keeps published risk monotonically decreasing in safety", () => {
        const risk = (safeTransitionScore: number) =>
            GoodQuestionEngine.generateStructuredQuestion({
                stage: "Approve",
                targetNodeOrFile: "t.ts",
                evaluationResult: makeEvaluation({ safeTransitionScore }),
            }).proofContext.riskScore;

        expect(risk(0.1)).toBeGreaterThan(risk(0.5));
        expect(risk(0.5)).toBeGreaterThan(risk(0.95));
    });

    it("stays within 0..1", () => {
        for (const s of [0, 0.25, 0.5, 0.75, 1]) {
            const r = GoodQuestionEngine.generateStructuredQuestion({
                stage: "Approve",
                targetNodeOrFile: "t.ts",
                evaluationResult: makeEvaluation({ safeTransitionScore: s }),
            }).proofContext.riskScore;
            expect(r).toBeGreaterThanOrEqual(0);
            expect(r).toBeLessThanOrEqual(1);
        }
    });
});
