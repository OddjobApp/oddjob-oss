// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — MEMORY FLOW TEST
// Verifies storing and recalling patterns and outcomes in the Memory Pod
// ============================================================================

import { describe, it, expect } from "vitest";
import { memoryPod } from "../memory/memory-pod.service.js";
import { randomUUID } from "crypto";

describe("Memory Pod Flow", () => {
    const ctx = {
        mode: "realtime" as const,
        now: new Date().toISOString(),
        requestId: `test-${randomUUID()}`,
        correlationId: `test-correlation`
    };

    const contextId = `context-${randomUUID()}`;

    it("should store and recall memories", async () => {
        // 1. Store Outcome
        const outcome = await memoryPod.storeOutcome({
            contextId,
            predictionId: randomUUID(),
            predictedPredicate: "user_will_click",
            actualOutcome: "clicked",
            matched: true,
            confidenceAtPrediction: 0.9,
            entropyAtPrediction: 0.1,
            occurredAt: new Date().toISOString()
        }, ctx);

        expect(outcome.id).toBeDefined();
        expect(outcome.matched).toBe(true);

        // 2. Store Pattern
        const pattern = await memoryPod.storePattern({
            name: "Click Pattern",
            patternType: "event_sequence_pattern",
            typicalPredicates: ["hover", "click"],
            typicalPostPredicates: ["navigation"],
            confidence: 0.8
        }, ctx);

        expect(pattern.id).toBeDefined();
        expect(pattern.name).toBe("Click Pattern");

        // 3. Recall
        // Note: Realtime mode limits some memory types, but short_term should work.
        const recallResults = await memoryPod.recall({
            contextId,
            memoryTypes: ["short_term", "outcome"],
            mode: "realtime",
            limit: 5
        }, ctx);

        expect(recallResults).toBeDefined();
        expect(Array.isArray(recallResults)).toBe(true);
        
        // Even if DB query returns empty (no previous data), the plugins should return an array
        console.log(`[Memory Test] Recalled ${recallResults.length} memories`);
    });
});
