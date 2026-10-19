import { describe, it, expect } from "vitest";
import { DynamicTuningService } from "../../server/domain/ai/core/dynamic-tuning.service.js";

describe("Dynamic Runtime Tuning & Adaptive Calibration Suite", () => {
    it("should dynamically scale down token budget for high-momentum agent success", () => {
        const tuning = DynamicTuningService.tuneRuntimeParameters({
            stage: "Improve",
            targetFileOrNode: "server/routes/dispatch.ts",
            safeTransitionScore: 0.88,
            history: {
                agentId: "fast_agent",
                consecutiveSuccesses: 4,
                consecutiveRetries: 0,
                averageLatencyMs: 320,
                lastSafeTransitionScore: 0.88
            }
        });

        expect(tuning.adjustedTokenBudget).toBe(240); // 20% reduction (300 -> 240)
        expect(tuning.recommendedModelTier).toBe("8b_small");
        expect(tuning.adaptiveReason).toContain("High momentum");
    });

    it("should dynamically expand token budget and upgrade model tier on retry", () => {
        const tuning = DynamicTuningService.tuneRuntimeParameters({
            stage: "Diagnose",
            targetFileOrNode: "server/routes/dispatch.ts",
            safeTransitionScore: 0.55,
            history: {
                agentId: "retry_agent",
                consecutiveSuccesses: 0,
                consecutiveRetries: 1,
                averageLatencyMs: 890,
                lastSafeTransitionScore: 0.55
            }
        });

        expect(tuning.adjustedTokenBudget).toBe(420); // 40% expansion (300 -> 420)
        expect(tuning.recommendedModelTier).toBe("frontier_large");
        expect(tuning.adaptiveReason).toContain("Retry detected");
    });

    it("should enforce stricter safety thresholds for production database targets", () => {
        const tuning = DynamicTuningService.tuneRuntimeParameters({
            stage: "Deploy",
            targetFileOrNode: "prod/database/schema.ts",
            safeTransitionScore: 0.88,
            history: {
                agentId: "deploy_agent",
                consecutiveSuccesses: 1,
                consecutiveRetries: 0,
                averageLatencyMs: 400,
                lastSafeTransitionScore: 0.88
            }
        });

        expect(tuning.requiredSafetyThreshold).toBe(0.92); // Stricter threshold for prod
        expect(tuning.recommendedModelTier).toBe("haiku_mid"); // Upgraded tier because 0.88 < 0.92
    });
});
