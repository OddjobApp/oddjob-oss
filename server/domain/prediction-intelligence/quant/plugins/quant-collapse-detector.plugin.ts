import { randomUUID } from "crypto";
import type {
    PredictionPlugin, PluginManifest, PluginContext, PluginDecision, PluginResult, PluginHealth, PluginMetrics,
} from "../../plugin-runtime/types.js";
import type { QuantCollapseInput, PredictionCollapseSignal } from "../types.js";

// ============================================================================
// QUANT COLLAPSE DETECTOR PLUGIN — Spec §21
// MVP: threshold-based. Full attractor-pull version deferred.
// ============================================================================

const manifest: PluginManifest = {
    name: "quant-collapse-detector", version: "1.0.0", pod: "quant", subPod: "collapse",
    capability: "quant.detect_collapse",
    description: "Detects when quant field entropy collapses toward a branch or hidden state",
    owner: "prediction-intelligence",
    inputTypes: ["QuantCollapseInput"], outputTypes: ["PredictionCollapseSignal"],
    execution: { type: "typescript_in_process", mode: "sync", latencyClass: "realtime", timeoutMs: 15, retryable: false, maxRetries: 0 },
    state: { readsState: false, writesState: false, stateKeys: [] },
    storage: { postgres: { read: false, write: false, tables: [] }, qdrant: { read: false, write: false, collections: [] }, redis: { read: false, write: false, keyPrefixes: [] }, objectStorage: { read: false, write: false, buckets: [] } },
    agents: { usesAgents: false, allowedForHotPath: true, maxAgentCalls: 0 },
    safety: { deterministic: true, requiresGovernance: false, producesAction: false, producesInference: true, producesPrediction: true, mayIncreaseRisk: false },
    dependencies: { requiredPlugins: ["quant-field-summary"], optionalPlugins: [], externalServices: [] },
    rollout: { status: "active", trafficPercent: 100 },
};

function met(start: string): PluginMetrics {
    const end = new Date().toISOString();
    return { startedAt: start, completedAt: end, durationMs: Date.parse(end) - Date.parse(start), dbReads: 0, dbWrites: 0, vectorQueries: 0, cacheReads: 0, cacheWrites: 0, agentCalls: 0, outputSizeBytes: 0 };
}

// spec §21: collapseDetected when entropy low, coherence high, collapse probability crosses threshold
const COLLAPSE_COHERENCE_THRESHOLD = 0.75;
const COLLAPSE_ENTROPY_THRESHOLD = 0.25;
const COLLAPSE_PROBABILITY_THRESHOLD = 0.60;

export const quantCollapseDetectorPlugin: PredictionPlugin<QuantCollapseInput, PredictionCollapseSignal> = {
    manifest,
    async canHandle(input: QuantCollapseInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && !!input?.field;
        return { shouldRun: ok, reason: ok ? "valid" : "missing field summary", priority: 55, estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },
    async execute(input: QuantCollapseInput, ctx: PluginContext): Promise<PluginResult<PredictionCollapseSignal>> {
        const start = new Date().toISOString();
        const { contextId, field } = input;
        const collapseDetected = field.fieldCoherence >= COLLAPSE_COHERENCE_THRESHOLD
            && field.fieldEntropy <= COLLAPSE_ENTROPY_THRESHOLD
            && field.collapseProbability >= COLLAPSE_PROBABILITY_THRESHOLD;

        const signal: PredictionCollapseSignal = {
            id: randomUUID(), contextId, collapseDetected,
            targetType: "branch",
            confidence: field.collapseProbability,
            supportingQuantIds: [], interferingQuantIds: [],
            fieldEntropy: field.fieldEntropy, fieldCoherence: field.fieldCoherence,
            createdAt: ctx.now,
        };

        return {
            pluginName: manifest.name, pluginVersion: manifest.version, status: "success",
            output: signal, confidence: field.collapseProbability, evidenceIds: [],
            warnings: collapseDetected ? [] : [{ code: "NO_COLLAPSE", message: "Collapse conditions not met", severity: "info" }],
            errors: [], metrics: met(start),
            provenance: { source: "plugin", method: "threshold_collapse_detection", pluginName: manifest.name, pluginVersion: manifest.version, evidenceIds: [], createdAt: ctx.now },
        };
    },
    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
