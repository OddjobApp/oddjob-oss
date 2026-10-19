// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — OUTCOME MEMORY TEST
// Verifies the relevance scoring and sorting in the Memory Pod
// ============================================================================

import { describe, it, expect } from "vitest";
import { outcomeMemoryPlugin } from "../memory/plugins/outcome-memory.plugin.js";
import { createPluginContext } from "../plugin-runtime/plugin-runtime.js";
import { randomUUID } from "crypto";

describe("Outcome Memory Plugin", () => {
    const ctx = createPluginContext({
        contextId: "test-context",
        mode: "realtime",
        requestId: `test-${randomUUID()}`,
        correlationId: `test-correlation`,
        permissions: { canWriteInferences: true, canWritePredictions: false, canCallAgents: false, canReadSensitiveData: false, canUseGeographicData: false, canUseSpatialData: false }
    });

    it("should score and sort outcomes by relevance and reliability", async () => {
        const now = new Date().toISOString();

        const mockOutcomes = [
            {
                id: "outcome-1",
                contextId: "test-context",
                predictionId: "pred-1",
                predictedPredicate: "user_will_click",
                actualOutcome: "clicked",
                matched: true, // High reliability
                confidenceAtPrediction: 0.9,
                entropyAtPrediction: 0.1,
                occurredAt: now,
                recordedAt: now
            },
            {
                id: "outcome-2",
                contextId: "test-context",
                predictionId: "pred-2",
                predictedPredicate: "user_will_hover",
                actualOutcome: "none",
                matched: false, // Low reliability
                confidenceAtPrediction: 0.5,
                entropyAtPrediction: 0.5,
                occurredAt: now,
                recordedAt: now
            }
        ];

        const result = await outcomeMemoryPlugin.execute({
            contextId: "test-context",
            outcomes: mockOutcomes as any,
            targetPredicates: ["user_will_click"],
            mode: "realtime"
        }, ctx);

        expect(result.status).toBe("success");
        expect(result.output).toBeDefined();
        
        const results = result.output!;
        expect(results.length).toBe(2);
        
        // Outcome 1 should be first because it matches the target predicate and is matched
        expect(results[0].id).toBe("outcome-1");
        expect(results[0].relevance).toBe(1.0);
        expect(results[0].outcomeReliability).toBe(0.9);
        
        // Outcome 2 should be second
        expect(results[1].id).toBe("outcome-2");
        expect(results[1].relevance).toBe(0.2); // No match
        expect(results[1].outcomeReliability).toBe(0.4);
    });
});
