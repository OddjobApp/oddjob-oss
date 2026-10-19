// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — COMPLEX FLOW TEST
// Verifies the integration of Canonical Events and the 3 new Predictors
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { canonicalEventService } from "../canonical-event/canonical-event.service.js";
import { hilPredictor } from "../prediction/hil-predictor.js";
import { forgePredictor } from "../prediction/forge-predictor.js";
import { researchPredictor } from "../prediction/research-predictor.js";
import { randomUUID } from "crypto";

describe("Complex Prediction Flow", () => {
    const ctx = {
        mode: "realtime" as const,
        now: new Date().toISOString(),
        requestId: `test-${randomUUID()}`,
        correlationId: `test-correlation`
    };

    // ------------------------------------------------------------------------
    // Test 1: Canonical Event Ingestion
    // ------------------------------------------------------------------------
    it("should ingest and validate a raw event", async () => {
        const rawEvent = {
            source: "test_source",
            action: "test_action",
            payload: { data: "value" },
            contextHint: "test-context"
        };

        const result = await canonicalEventService.canonicalize(rawEvent, ctx);

        expect(result.event).toBeDefined();
        expect(result.event?.source).toBe("test_source");
        expect(result.event?.schemaVersion).toBe("1.0");
    });

    // ------------------------------------------------------------------------
    // Test 2: HIL Prediction (Option 4)
    // ------------------------------------------------------------------------
    it("should predict HIL requirement for high-risk plans", async () => {
        const mockPlan = {
            steps: [
                { action: "fetch_data", risk: "low" },
                { action: "deploy_to_production", risk: "high" } // Trigger
            ]
        };

        const prediction = await hilPredictor.predictHilRequirement(123, mockPlan as any, ctx);

        expect(prediction.requiresHil).toBe(true);
        expect(prediction.confidence).toBeGreaterThan(0.8);
        expect(prediction.predictedFormName).toBe("deployment_approval");
    });

    // ------------------------------------------------------------------------
    // Test 3: Forge Failure Prediction (Option 3)
    // ------------------------------------------------------------------------
    /**
     * predictForgeFailure rolls a die: `const mockSystemLoad = Math.random()`,
     * and above 0.8 it overrides the action to "retry". This assertion was
     * therefore a 1-in-5 failure on every run, independent of ordering — it is
     * how this suite entered the failing set. The roll is pinned here rather
     * than left to chance, and both branches are covered.
     *
     * The placeholder is still in the predictor: its own comment says a real
     * implementation should read Redis or the active workers, so until it does,
     * the suggested action is partly random in production too.
     */
    it("should predict high failure probability for complex blueprints", async () => {
        const options = { skipToAssembly: true };
        const blueprintSlug = "heavy-enterprise-template"; // Trigger

        const roll = vi.spyOn(Math, "random").mockReturnValue(0.5); // below the load threshold
        try {
            const prediction = await forgePredictor.predictForgeFailure("my-app", blueprintSlug, options, ctx);

            expect(prediction.failProbability).toBeGreaterThan(0.5);
            expect(prediction.reason).toContain("Complex blueprint");
            expect(prediction.suggestedAction).toBe("pause");
        } finally {
            roll.mockRestore();
        }
    });

    it("suggests a retry instead when system load is high", async () => {
        const roll = vi.spyOn(Math, "random").mockReturnValue(0.95); // above the load threshold
        try {
            const prediction = await forgePredictor.predictForgeFailure(
                "my-app",
                "heavy-enterprise-template",
                { skipToAssembly: true },
                ctx,
            );

            expect(prediction.suggestedAction).toBe("retry");
            expect(prediction.reason).toContain("High system load");
        } finally {
            roll.mockRestore();
        }
    });

    // ------------------------------------------------------------------------
    // Test 4: Research Targeting Prediction (Option 5)
    // ------------------------------------------------------------------------
    it("should suggest business sources for competitor research", async () => {
        const goal = "Analyze the competitor landscape for Paperclip AI"; // Triggers both

        const prediction = await researchPredictor.predictResearchTargets(goal, ctx);

        expect(prediction.suggestedSources).toContain("crunchbase.com");
        expect(prediction.suggestedSources).toContain("github.com"); // From "AI" trigger
        expect(prediction.priorityKeywords).toContain("market share");
    });
});
