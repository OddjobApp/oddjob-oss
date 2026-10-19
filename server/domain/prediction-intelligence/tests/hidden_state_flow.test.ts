// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — HIDDEN STATE FLOW TEST
// Verifies the full chain of the Hidden State Pod (candidates, scoring, entropy)
// ============================================================================

import { describe, it, expect } from "vitest";
import { hiddenStatePod } from "../hidden-state/hidden-state-pod.service.js";
import { randomUUID } from "crypto";

describe("Hidden State Pod Flow", () => {
    const ctx = {
        mode: "realtime" as const,
        now: new Date().toISOString(),
        requestId: `test-${randomUUID()}`,
        correlationId: `test-correlation`
    };

    it("should execute the full estimation pipeline", async () => {
        const contextId = `context-${randomUUID()}`;

        const mockInput = {
            context: { id: contextId, sessionId: "session-1", mode: "realtime" as const, createdAt: new Date().toISOString() },
            activeQuants: [],
            quantField: { id: "field-1", fieldEntropy: 0.5, fieldCoherence: 0.5 } as any,
            realmResults: { contributions: [] } as any,
            memoryResults: [],
            mode: "realtime" as const
        };

        const result = await hiddenStatePod.estimate(mockInput, ctx);

        expect(result).toBeDefined();
        expect(result.id).toBeDefined();
        expect(result.contextId).toBe(contextId);
        expect(result.candidates).toBeDefined();
        expect(result.entropy).toBeDefined();

        console.log(`[Hidden State Test] Estimate ID: ${result.id}, Candidates: ${result.candidates.length}, Entropy: ${result.entropy}`);
    });
});
