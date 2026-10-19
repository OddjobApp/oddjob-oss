// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — MULTI-POD INTEGRATION TEST
// Verifies the flow and handoff across Hidden State, Prediction, Pruning, and Explanation pods.
// ============================================================================

import { describe, it, expect } from "vitest";
import { hiddenStatePod } from "../hidden-state/hidden-state-pod.service.js";
import { predictionPod } from "../prediction/prediction-pod.service.js";
import { pruningPod } from "../pruning/pruning-pod.service.js";
import { explanationPod } from "../explanation/explanation-pod.service.js";
import { randomUUID } from "crypto";

describe("Multi-Pod Integration Flow", () => {
    const ctx = {
        mode: "realtime" as const,
        now: new Date().toISOString(),
        requestId: `test-${randomUUID()}`,
        correlationId: `test-correlation`
    };

    it("should execute the full chain from state inference to explanation", async () => {
        const contextId = `context-${randomUUID()}`;
        const predictionId = randomUUID();

        console.log("\n--- STARTING MULTI-POD FLOW ---");

        // STEP 1: Hidden State Inference
        console.log("[Flow] Step 1: Inferring hidden state...");
        const stateEstimate = await hiddenStatePod.estimate({
            context: { id: contextId, sessionId: "session-1", mode: "realtime" as const, createdAt: ctx.now },
            activeQuants: [],
            quantField: { id: "field-1", fieldEntropy: 0.5, fieldCoherence: 0.5 } as any,
            realmResults: { contributions: [] } as any,
            memoryResults: [],
            mode: "realtime" as const
        }, ctx);

        expect(stateEstimate).toBeDefined();
        console.log(`[Flow] -> Hidden State: '${stateEstimate.topLabel}' (Entropy: ${stateEstimate.entropy})`);

        // STEP 2: Branch Generation (Prediction Pod)
        console.log("[Flow] Step 2: Generating prediction branches...");
        const branches = await predictionPod.generateBranches({
            predictionId,
            context: { id: contextId, sessionId: "session-1", mode: "realtime" as const, createdAt: ctx.now },
            predicates: [
                {
                    label: "user_will_click",
                    confidence: 0.8,
                    riskClass: "low",
                    expectedValue: 0.8,
                    supportingQuantIds: [],
                    supportingRealmContributionIds: [],
                    source: "manual"
                },
                {
                    label: "user_will_bounce",
                    confidence: 0.2,
                    riskClass: "low",
                    expectedValue: -0.2,
                    supportingQuantIds: [],
                    supportingRealmContributionIds: [],
                    source: "manual"
                }
            ] as any,
            quantField: { id: "field-1", fieldEntropy: 0.5 } as any,
            hiddenState: stateEstimate,
            realmContributions: [],
            memoryMatches: [],
            modePlan: { maxBranches: 5, timeoutMs: 100 } as any,
            now: ctx.now
        }, ctx);

        expect(branches).toBeDefined();
        expect(branches.length).toBeGreaterThan(0);
        console.log(`[Flow] -> Generated ${branches.length} branches`);

        // STEP 3: Pruning & Suppression (Pruning Pod)
        console.log("[Flow] Step 3: Running pruning pipeline...");
        const pruningResult = await pruningPod.prune({
            predictionId,
            contextId,
            branches: branches,
            activeQuants: [],
            realmContributions: [],
            realmConflicts: [],
            modePlan: {} as any,
            mode: "realtime" as const
        }, ctx);

        expect(pruningResult).toBeDefined();
        console.log(`[Flow] -> Pruning complete. Active: ${pruningResult.activeBranches.length}, Pruned: ${pruningResult.prunedBranches.length}`);

        // STEP 4: Explanation Generation (Explanation Pod)
        console.log("[Flow] Step 4: Generating explanation...");
        const explanation = await explanationPod.explainPrediction({
            predictionId,
            contextId,
            explanationType: "causal" as const,
            audience: "operator" as const,
            confidence: 0.75,
            entropy: 0.25,
            branches: [...pruningResult.activeBranches, ...pruningResult.prunedBranches],
            hiddenStates: [stateEstimate],
            realmResults: { contributions: [] } as any
        } as any, ctx);

        expect(explanation).toBeDefined();
        console.log(`[Flow] -> Explanation Summary: "${explanation.summary}"`);
        console.log("--- MULTI-POD FLOW COMPLETE ---\n");
    });
});
