// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — EXPLANATION TEST
// Verifies narrative generation and evidence summarization in the Explanation Pod
// ============================================================================

import { describe, it, expect } from "vitest";
import { explanationPod } from "../explanation/explanation-pod.service.js";
import { randomUUID } from "crypto";

describe("Explanation Pod", () => {
    const ctx = {
        mode: "realtime" as const,
        now: new Date().toISOString(),
        requestId: `test-${randomUUID()}`,
        correlationId: `test-correlation`
    };

    it("should generate a prediction explanation with narratives", async () => {
        const predictionId = randomUUID();
        const contextId = `context-${randomUUID()}`;

        const mockInput = {
            predictionId,
            contextId,
            explanationType: "causal" as const,
            audience: "operator" as const,
            confidence: 0.8,
            entropy: 0.2,
            branches: [
                {
                    id: "branch-1",
                    predictionId,
                    contextId,
                    predicate: "user_will_click",
                    probability: 0.8,
                    branchScore: 0.8,
                    status: "active" as const,
                    supportingQuantIds: ["quant-1"],
                    interferingQuantIds: [],
                    createdAt: ctx.now,
                    updatedAt: ctx.now
                },
                {
                    id: "branch-2",
                    predictionId,
                    contextId,
                    predicate: "user_will_bounce",
                    probability: 0.1,
                    branchScore: 0.1,
                    status: "pruned" as const,
                    supportingQuantIds: [],
                    interferingQuantIds: ["quant-2"],
                    createdAt: ctx.now,
                    updatedAt: ctx.now
                }
            ],
            realmResults: {
                contributions: [
                    { realm: "web", amount: 0.7, confidence: 0.9 },
                    { realm: "db", amount: 0.2, confidence: 0.8 }
                ],
                agreement: { score: 0.85 }
            } as any,
            hiddenStates: [
                {
                    id: "hs-1",
                    candidates: [
                        { id: "c-1", label: "engaged", probability: 0.9, confidence: 0.9, supportingQuantIds: [] }
                    ],
                    entropy: 0.1,
                    splitDetected: false,
                    collapseDetected: true
                }
            ] as any
        };

        const result = await explanationPod.explainPrediction(mockInput as any, ctx);

        expect(result).toBeDefined();
        expect(result.predictionId).toBe(predictionId);
        expect(result.summary).toContain("user_will_click");
        expect(result.summary).toContain("80%"); // confidence * 100

        // Verify evidence partitioning
        expect(result.supportingEvidence.length).toBe(1);
        expect(result.supportingEvidence[0].id).toBe("branch-1");
        
        expect(result.contradictoryEvidence.length).toBe(1);
        expect(result.contradictoryEvidence[0].id).toBe("branch-2");

        // Verify narratives
        expect(result.confidenceNarrative).toBeDefined();
        expect(result.entropyNarrative).toBeDefined();
        expect(result.epistemicNarrative).toBeDefined();

        console.log(`[Explanation Test] Summary: ${result.summary}`);
    });
});
