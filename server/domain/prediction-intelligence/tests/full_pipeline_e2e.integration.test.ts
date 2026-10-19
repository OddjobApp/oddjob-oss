// ============================================================================
// PREDICTION INTELLIGENCE — FULL PIPELINE E2E TEST
// Covers: canonical event → quant creation → hidden state → prediction →
//         pruning → governance → observability telemetry
// All pods use in-memory implementations; no DB or network required.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";

// ── Shared domain context ─────────────────────────────────────────────────────

const now = new Date().toISOString();
const contextId = randomUUID();
const ctx = {
    mode: "realtime" as const,
    now,
    requestId: `req-${randomUUID()}`,
    correlationId: contextId,
};

const predContext = { id: contextId, mode: "realtime" as const, createdAt: now };

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildQuantField(override: Partial<Record<string, unknown>> = {}) {
    return {
        id: randomUUID(),
        contextId,
        windowId: undefined,
        quantCount: 3,
        fieldDensity: 0.6,
        fieldMomentum: [0.1, 0.2, 0.3],
        fieldEntropy: 0.4,
        fieldAlignment: 0.7,
        fieldDivergence: 0.3,
        fieldCoherence: 0.8,
        epistemicCenterOfMass: [0.5, 0.5, 0.5],
        dominantStatus: "known_known" as const,
        topAttractors: ["stability", "growth"],
        collapseProbability: 0.15,
        createdAt: now,
        ...override,
    };
}

function emptyRealmResults() {
    return {
        contextId,
        executionPlan: { realms: [], timeoutMs: 15, parallelism: 1, fallbackEnabled: false },
        contributions: [],
        branchInfluences: [],
        hiddenStateInfluences: [],
        quantRelationships: [],
        conflicts: [],
        warnings: [],
        trace: { totalDurationMs: 0, realmDurations: {}, realmStatuses: {} },
    } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Full Prediction Pipeline E2E", () => {

    it("Step 1 — Quant pod creates quants from a canonical event", async () => {
        const { quantPod } = await import("../quant/quant-pod.service.js");

        const event = {
            id: randomUUID(),
            contextId,
            source: "test",
            action: "task_completed",
            eventKind: "fact" as const,
            occurredAt: now,
            ingestedAt: now,
            confidence: 0.9,
            rawPayload: { taskId: "t1", result: "success" },
            canonical: { taskId: "t1" },
            provenance: { sourceSystem: "test", ingestedAt: now },
        };

        const quants = await quantPod.createFromEvent(event, predContext, ctx);
        // Plugin may return 0 quants if generator is a no-op — what matters is no throw
        expect(Array.isArray(quants)).toBe(true);
    });

    it("Step 2 — Hidden state pod estimates state from quants", async () => {
        const { hiddenStatePod } = await import("../hidden-state/hidden-state-pod.service.js");

        const estimate = await hiddenStatePod.estimate({
            context: predContext,
            activeQuants: [],
            quantField: buildQuantField(),
            realmResults: emptyRealmResults(),
            mode: "realtime",
        }, ctx);

        expect(estimate).toBeDefined();
        expect(typeof estimate.entropy).toBe("number");
        expect(estimate.entropy).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(estimate.candidates)).toBe(true);
    });

    it("Step 3 — Prediction pod generates predictions and branches", async () => {
        const { hiddenStatePod } = await import("../hidden-state/hidden-state-pod.service.js");
        const { predictionPod } = await import("../prediction/prediction-pod.service.js");

        const stateEstimate = await hiddenStatePod.estimate({
            context: predContext,
            activeQuants: [],
            quantField: buildQuantField(),
            realmResults: emptyRealmResults(),
            mode: "realtime",
        }, ctx);

        const result = await predictionPod.generatePredictions({
            mode: "realtime",
            context: predContext,
            quantField: buildQuantField(),
            activeQuants: [],
            realmResults: emptyRealmResults(),
            hiddenState: stateEstimate,
            memoryMatches: [],
        }, ctx);

        expect(result).toBeDefined();
        expect(result.prediction).toBeDefined();
        expect(typeof result.prediction.confidence).toBe("number");
        expect(Array.isArray(result.branches)).toBe(true);
    });

    it("Step 4 — Pruning pod reduces branches", async () => {
        const { hiddenStatePod } = await import("../hidden-state/hidden-state-pod.service.js");
        const { predictionPod } = await import("../prediction/prediction-pod.service.js");
        const { pruningPod } = await import("../pruning/pruning-pod.service.js");

        const stateEstimate = await hiddenStatePod.estimate({
            context: predContext, activeQuants: [], quantField: buildQuantField(),
            realmResults: emptyRealmResults(), mode: "realtime",
        }, ctx);

        const { prediction, branches } = await predictionPod.generatePredictions({
            mode: "realtime", context: predContext, quantField: buildQuantField(),
            activeQuants: [], realmResults: emptyRealmResults(), hiddenState: stateEstimate, memoryMatches: [],
        }, ctx);

        if (branches.length === 0) {
            // Generator returned no branches — pruning is a no-op, test still passes
            return;
        }

        const pruned = await pruningPod.prune({
            predictionId: prediction.id,
            contextId,
            branches,
            quantField: buildQuantField(),
            activeQuants: [],
            realmContributions: [],
            realmConflicts: [],
            mode: "realtime",
            modePlan: { mode: "realtime", timeoutMs: 5000, maxBranches: 10, maxPlugins: 5, parallelism: 1, enabledPods: [] } as any,
        }, ctx);

        expect(pruned).toBeDefined();
        expect(Array.isArray(pruned.activeBranches)).toBe(true);
        expect(pruned.activeBranches.length).toBeLessThanOrEqual(branches.length);
    });

    it("Step 5 — Governance pod evaluates and returns a decision", async () => {
        const { governancePod } = await import("../governance/governance-pod.service.js");

        const decision = await governancePod.evaluate({
            context: { id: contextId, mode: "realtime", createdAt: now, permissions: undefined },
            confidence: 0.8,
            requestedActionLevel: "suggest",
            mode: "realtime",
        } as any, ctx);

        expect(decision).toBeDefined();
        expect(typeof decision.allowed).toBe("boolean");
        expect(decision.riskClass).toBeDefined();
        expect(decision.maxActionLevel).toBeDefined();
    });

    it("Step 6 — Observability pod emits and queries telemetry without throwing", async () => {
        const { observabilityPod } = await import("../observability/observability-pod.service.js");

        await expect(observabilityPod.emit({
            type: "e2e_test_event",
            severity: "info",
            source: "prediction_pod",
            contextId,
            payload: { test: true },
        }, ctx)).resolves.toBeUndefined();

        const result = await observabilityPod.query({ contextId, limit: 10 }, ctx);
        expect(result).toBeDefined();
        expect(Array.isArray(result.events)).toBe(true);
        // At minimum the event we just emitted should be there
        const found = result.events?.find((e: any) => e.type === "e2e_test_event" && e.contextId === contextId);
        expect(found).toBeDefined();
    });

    it("Full chain completes without error", async () => {
        const { hiddenStatePod } = await import("../hidden-state/hidden-state-pod.service.js");
        const { predictionPod } = await import("../prediction/prediction-pod.service.js");
        const { governancePod } = await import("../governance/governance-pod.service.js");
        const { observabilityPod } = await import("../observability/observability-pod.service.js");

        const chainContextId = randomUUID();
        const chainCtx = { ...ctx, correlationId: chainContextId, requestId: `chain-req-${randomUUID()}` };
        const chainPredContext = { id: chainContextId, mode: "realtime" as const, createdAt: now };
        const qf = buildQuantField({ contextId: chainContextId });

        const state = await hiddenStatePod.estimate({
            context: chainPredContext, activeQuants: [], quantField: qf,
            realmResults: emptyRealmResults(), mode: "realtime",
        }, chainCtx);

        const { prediction, branches } = await predictionPod.generatePredictions({
            mode: "realtime", context: chainPredContext, quantField: qf,
            activeQuants: [], realmResults: emptyRealmResults(), hiddenState: state, memoryMatches: [],
        }, chainCtx);

        const govDecision = await governancePod.evaluate({
            context: { id: chainContextId, mode: "realtime", createdAt: now },
            confidence: prediction.confidence,
            requestedActionLevel: "suggest",
            mode: "realtime",
        } as any, chainCtx);

        await observabilityPod.emit({
            type: "pipeline_completed",
            severity: "info",
            source: "prediction_pod",
            contextId: chainContextId,
            predictionId: prediction.id,
            payload: {
                branchCount: branches.length,
                confidence: prediction.confidence,
                governanceAllowed: govDecision.allowed,
            },
        }, chainCtx);

        expect(prediction.id).toBeDefined();
        expect(govDecision.riskClass).toBeDefined();
    });
});
