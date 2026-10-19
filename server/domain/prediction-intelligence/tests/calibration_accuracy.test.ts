// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — CALIBRATION ACCURACY TEST
// Verifies Brier score, log loss, and error flags in the Calibration Pod
// ============================================================================

import { describe, it, expect } from "vitest";
import { predictionAccuracyPlugin } from "../calibration/plugins/prediction-accuracy.plugin.js";
import { createPluginContext } from "../plugin-runtime/plugin-runtime.js";
import { randomUUID } from "crypto";

describe("Prediction Accuracy Plugin", () => {
    const ctx = createPluginContext({
        contextId: "test-context",
        mode: "realtime",
        requestId: `test-${randomUUID()}`,
        correlationId: `test-correlation`,
        permissions: { canWriteInferences: true, canWritePredictions: false, canCallAgents: false, canReadSensitiveData: false, canUseGeographicData: false, canUseSpatialData: false }
    });

    it("should calculate accuracy and scores for correct prediction", async () => {
        const result = await predictionAccuracyPlugin.execute({
            contextId: "test-context",
            predictionId: "pred-1",
            topPredicate: "user_will_click",
            confidence: 0.9,
            entropy: 0.1,
            branches: [],
            outcome: { id: "outcome-1" } as any,
            bestMatch: {
                id: "match-1",
                matchType: "exact",
                matchScore: 1.0,
                matchedPredicate: "user_will_click"
            } as any
        }, ctx);

        expect(result.status).toBe("success");
        expect(result.output).toBeDefined();
        
        const co = result.output!;
        expect(co.topPredictionCorrect).toBe(true);
        
        // Brier Score: (0.9 - 1)^2 = 0.01
        expect(co.brierScore).toBeCloseTo(0.01, 4);
        
        // Log Loss: -ln(0.9) ≈ 0.10536
        expect(co.logLoss).toBeCloseTo(0.1054, 4);
        
        expect(co.overconfident).toBe(false);
        expect(co.underconfident).toBe(false);
    });

    it("should flag overconfidence for incorrect prediction with high confidence", async () => {
        const result = await predictionAccuracyPlugin.execute({
            contextId: "test-context",
            predictionId: "pred-2",
            topPredicate: "user_will_click",
            confidence: 0.9, // High confidence but wrong
            entropy: 0.1,
            branches: [],
            outcome: { id: "outcome-2" } as any,
            bestMatch: {
                id: "match-2",
                matchType: "missed",
                matchScore: 0.2,
                matchedPredicate: "user_will_click"
            } as any
        }, ctx);

        expect(result.status).toBe("success");
        
        const co = result.output!;
        expect(co.topPredictionCorrect).toBe(false);
        
        // Brier Score: (0.9 - 0)^2 = 0.81
        expect(co.brierScore).toBeCloseTo(0.81, 4);
        
        // OVERCONFIDENCE_THRESHOLD is usually 0.7 or 0.8. 0.9 should trigger it.
        expect(co.overconfident).toBe(true);
        expect(co.falsePositive).toBe(true);
    });
});
