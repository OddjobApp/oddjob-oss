// ============================================================================
// MCP HANDLERS — PREDICTION INTELLIGENCE
// Exposes prediction pods via MCP tools.
// ============================================================================

import { hiddenStatePod } from "../../domain/prediction-intelligence/hidden-state/hidden-state-pod.service.js";
import { predictionPod } from "../../domain/prediction-intelligence/prediction/prediction-pod.service.js";
import { explanationPod } from "../../domain/prediction-intelligence/explanation/explanation-pod.service.js";
import { successResponse, errorResponse, validateArgs, type ToolContext } from "./utils.js";
import { randomUUID } from "crypto";
import type { Quant, QuantFieldSummary, PredictionContext, DomainContext } from "../../domain/prediction-intelligence/quant/types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function runtimeContext(mode: DomainContext["mode"] = "realtime", organizationId?: number): DomainContext {
    return {
        mode,
        now: new Date().toISOString(),
        requestId: randomUUID(),
        correlationId: randomUUID(),
        organizationId,
    };
}

function predictionContext(contextId: string, now: string): PredictionContext {
    return { id: contextId, sessionId: "mcp-session", mode: "realtime", createdAt: now };
}

function quantField(contextId: string, quantCount: number, now: string): QuantFieldSummary {
    return {
        id: randomUUID(),
        contextId,
        quantCount,
        fieldDensity: quantCount,
        fieldMomentum: [0, 0, 0],
        fieldEntropy: quantCount > 0 ? 0.45 : 0.65,
        fieldAlignment: 0.5,
        fieldDivergence: 0.35,
        fieldCoherence: 0.5,
        epistemicCenterOfMass: [0.5, 0.5, 0.5],
        dominantStatus: "known_unknown",
        topAttractors: [],
        collapseProbability: 0.1,
        createdAt: now,
    };
}

function emptyRealmResults(contextId: string, now: string) {
    return {
        contextId,
        executionPlan: { id: randomUUID(), mode: "realtime" as const, orderedRealms: [], skippedRealms: [], parallelGroups: [], timeoutMs: 100, createdAt: now },
        contributions: [],
        branchInfluences: [],
        hiddenStateInfluences: [],
        quantRelationships: [],
        agreement: undefined,
        conflicts: [],
        warnings: [],
        trace: { id: randomUUID(), contextId, startedAt: now, completedAt: now, durationMs: 0, realmRuns: [] },
    };
}

function quantFromPredicate(contextId: string, label: string, now: string): Quant {
    return {
        id: randomUUID(),
        contextId,
        type: "prediction_signal",
        label,
        sourceEventIds: [],
        sourceEpisodeIds: [],
        sourcePredictionIds: [],
        sourceQuantIds: [],
        magnitude: 0.55,
        confidence: 0.65,
        uncertainty: 0.35,
        entropyContribution: 0.2,
        epistemic: {
            status: "known_unknown",
            worldKnownness: 0.55,
            systemKnownness: 0.65,
            evidenceStrength: 0.55,
            recognitionLevel: 0.65,
            resolutionLevel: 0.2,
        },
        position: { epistemic: [0.55, 0.65, 0.2] },
        trajectory: { velocity: [0, 0, 0], acceleration: [0, 0, 0], direction: [1, 0, 0] },
        realmContributions: [],
        branchInfluences: [],
        hiddenStateInfluences: [],
        relationships: [],
        lifecycle: { status: "active", decayRate: 0 },
        provenance: { sourceSystem: "mcp", ingestedAt: now },
        createdAt: now,
        updatedAt: now,
    };
}

/**
 * Handles get_hidden_state_estimate tool.
 */
export async function handleGetHiddenStateEstimate(args: unknown, context?: ToolContext) {
    const v = validateArgs<{ contextId: string }>(args, { contextId: 'string' });
    if ('isError' in v) return v;

    try {
        const { contextId } = v;

        const ctx = runtimeContext();
        const now = ctx.now;
        const internalContextId = UUID_PATTERN.test(contextId) ? contextId : randomUUID();
        const result = await hiddenStatePod.estimate({
            context: predictionContext(internalContextId, now),
            activeQuants: [],
            quantField: quantField(internalContextId, 0, now),
            realmResults: emptyRealmResults(internalContextId, now),
            memoryResults: [],
            mode: "realtime"
        }, ctx);

        return successResponse({ ...result, requestedContextId: contextId });
    } catch (error: any) {
        return errorResponse(`Failed to estimate hidden state: ${error.message}`);
    }
}

/**
 * Handles predict_outcomes tool.
 */
export async function handlePredictOutcomes(args: unknown, context?: ToolContext) {
    const v = validateArgs<{ contextId: string; predicates: string[] }>(
        args,
        { contextId: 'string', predicates: 'any' }
    );
    if ('isError' in v) return v;
    // validateArgs has no array kind, so the element contract is checked here.
    if (!Array.isArray(v.predicates) || v.predicates.some(p => typeof p !== 'string')) {
        return errorResponse('Field "predicates" must be an array of strings');
    }

    try {
        const { contextId, predicates } = v;

        const ctx = runtimeContext();
        const now = ctx.now;
        const internalContextId = UUID_PATTERN.test(contextId) ? contextId : randomUUID();
        const activeQuants = predicates.map((predicate: string) => quantFromPredicate(internalContextId, predicate, now));
        const field = quantField(internalContextId, activeQuants.length, now);
        const realmResults = emptyRealmResults(internalContextId, now);
        const contextShape = predictionContext(internalContextId, now);

        const hiddenState = await hiddenStatePod.estimate({
            context: contextShape,
            activeQuants,
            quantField: field,
            realmResults,
            memoryResults: [],
            mode: "realtime",
        }, ctx);

        const result = await predictionPod.generatePredictions({
            mode: "realtime",
            context: contextShape,
            activeQuants,
            quantField: field,
            realmResults,
            hiddenState,
            memoryMatches: [],
        }, ctx);

        return successResponse({
            requestedContextId: contextId,
            prediction: result.prediction,
            branches: result.branches,
            contract: result.contract,
        });
    } catch (error: any) {
        return errorResponse(`Failed to predict outcomes: ${error.message}`);
    }
}

/**
 * Handles explain_prediction tool.
 */
export async function handleExplainPrediction(args: unknown, context?: ToolContext) {
    const v = validateArgs<{ contextId: string; predictionId: string }>(
        args,
        { contextId: 'string', predictionId: 'string' }
    );
    if ('isError' in v) return v;

    try {
        const { contextId, predictionId } = v;

        const explanation = await explanationPod.explainPrediction({
            predictionId,
            contextId,
            explanationType: "causal",
            audience: "operator",
            confidence: 0.8,
            entropy: 0.2,
            branches: [],
            hiddenStates: [],
            realmResults: { contributions: [] } as any
        } as any, {
            mode: "realtime",
            now: new Date().toISOString(),
            requestId: `mcp-${randomUUID()}`
        } as any);

        return successResponse(explanation);
    } catch (error: any) {
        return errorResponse(`Failed to explain prediction: ${error.message}`);
    }
}
