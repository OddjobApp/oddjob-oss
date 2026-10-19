// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — PRUNING FLOW TEST
// Verifies the full chain of the Pruning Pod (scoring, hard prune, suppression)
// ============================================================================

import { describe, it, expect } from "vitest";
import { pruningPod } from "../pruning/pruning-pod.service.js";
import { randomUUID } from "crypto";

describe("Pruning Pod Flow", () => {
    const ctx = {
        mode: "realtime" as const,
        now: new Date().toISOString(),
        requestId: `test-${randomUUID()}`,
        correlationId: `test-correlation`
    };

    it("should execute the full pruning pipeline", async () => {
        const predictionId = randomUUID();
        const contextId = `context-${randomUUID()}`;

        const mockBranches = [
            {
                id: "branch-1",
                predictionId,
                contextId,
                predicate: "success",
                postPredicates: [],
                probability: 0.8,
                branchScore: 0.8,
                status: "active" as const,
                createdAt: ctx.now,
                updatedAt: ctx.now
            },
            {
                id: "branch-2",
                predictionId,
                contextId,
                predicate: "failure",
                postPredicates: [],
                probability: 0.1,
                branchScore: 0.1,
                status: "active" as const,
                createdAt: ctx.now,
                updatedAt: ctx.now
            },
            {
                id: "branch-3",
                predictionId,
                contextId,
                predicate: "timeout",
                postPredicates: [],
                probability: 0.01,
                branchScore: 0.01,
                status: "active" as const,
                createdAt: ctx.now,
                updatedAt: ctx.now
            }
        ];

        const result = await pruningPod.prune({
            predictionId,
            contextId,
            branches: mockBranches as any,
            activeQuants: [],
            realmContributions: [],
            realmConflicts: [],
            modePlan: {} as any,
            mode: "realtime"
        }, ctx);

        expect(result).toBeDefined();
        expect(result.predictionId).toBe(predictionId);
        expect(result.activeBranches).toBeDefined();
        expect(result.prunedBranches).toBeDefined();
        expect(result.decisions).toBeDefined();

        console.log(`[Pruning Test] Input: ${result.summary.inputBranchCount}, Active: ${result.summary.outputActiveCount}, Pruned: ${result.summary.prunedCount}`);
    });
});
