// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — RESEARCH INTEGRATION TEST
// Verifies that ResearchPredictor uses the Prediction Pod to score sources
// ============================================================================

import { describe, it, expect } from "vitest";
import { researchPredictor } from "../prediction/research-predictor.js";
import { randomUUID } from "crypto";

describe("Research Predictor Integration", () => {
    const ctx = {
        mode: "realtime" as const,
        now: new Date().toISOString(),
        requestId: `test-${randomUUID()}`,
        correlationId: `test-correlation`
    };

    it("should use prediction pod to suggest sources for AI goal", async () => {
        const goal = "Find the latest AI models and benchmarks";
        const result = await researchPredictor.predictResearchTargets(goal, ctx);

        expect(result).toBeDefined();
        expect(result.suggestedSources).toContain("github.com");
        expect(result.reason).toContain("Prediction engine prioritized");

        console.log(`[Research Integration Test] Sources: ${result.suggestedSources.join(", ")}`);
    });
});
