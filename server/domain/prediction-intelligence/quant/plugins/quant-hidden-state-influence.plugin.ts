import { randomUUID } from "crypto";
import type {
    PredictionPlugin, PluginManifest, PluginContext, PluginDecision, PluginResult, PluginHealth, PluginMetrics,
} from "../../plugin-runtime/types.js";
import type { QuantSingleHiddenStateInput, HiddenStateInfluence } from "../types.js";

// ============================================================================
// QUANT HIDDEN-STATE INFLUENCE PLUGIN — Spec §19
// ============================================================================

const manifest: PluginManifest = {
    name: "quant-hidden-state-influence", version: "1.0.0", pod: "quant", subPod: "hidden-state-influence",
    capability: "quant.influence_hidden_states",
    description: "Maps quant evidence to hidden state candidate effects",
    owner: "prediction-intelligence",
    inputTypes: ["QuantSingleHiddenStateInput"], outputTypes: ["HiddenStateInfluence[]"],
    execution: { type: "typescript_in_process", mode: "sync", latencyClass: "realtime", timeoutMs: 20, retryable: false, maxRetries: 0 },
    state: { readsState: false, writesState: false, stateKeys: [] },
    storage: { postgres: { read: false, write: false, tables: [] }, qdrant: { read: false, write: false, collections: [] }, redis: { read: false, write: false, keyPrefixes: [] }, objectStorage: { read: false, write: false, buckets: [] } },
    agents: { usesAgents: false, allowedForHotPath: true, maxAgentCalls: 0 },
    safety: { deterministic: true, requiresGovernance: false, producesAction: false, producesInference: true, producesPrediction: false, mayIncreaseRisk: false },
    dependencies: { requiredPlugins: [], optionalPlugins: [], externalServices: [] },
    rollout: { status: "active", trafficPercent: 100 },
};

function met(start: string): PluginMetrics {
    const end = new Date().toISOString();
    return { startedAt: start, completedAt: end, durationMs: Date.parse(end) - Date.parse(start), dbReads: 0, dbWrites: 0, vectorQueries: 0, cacheReads: 0, cacheWrites: 0, agentCalls: 0, outputSizeBytes: 0 };
}

function resolveEffect(type: string): HiddenStateInfluence["effect"] {
    if (type === "hidden_state_signal") return "support";
    if (type === "contradiction_signal") return "oppose";
    if (type === "anomaly_signal") return "destabilize";
    if (type === "resolution_signal") return "stabilize";
    if (type === "pattern_signal") return "stabilize";
    return "stabilize";
}

export const quantHiddenStateInfluencePlugin: PredictionPlugin<QuantSingleHiddenStateInput, HiddenStateInfluence[]> = {
    manifest,
    async canHandle(input: QuantSingleHiddenStateInput): Promise<PluginDecision> {
        const ok = !!input?.quant?.id && Array.isArray(input?.hiddenStateIds) && input.hiddenStateIds.length > 0;
        return { shouldRun: ok, reason: ok ? "valid" : "missing quant or hiddenStateIds", priority: 60, estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },
    async execute(input: QuantSingleHiddenStateInput, ctx: PluginContext): Promise<PluginResult<HiddenStateInfluence[]>> {
        const start = new Date().toISOString();
        const { quant: q, hiddenStateIds } = input;
        const now = ctx.now;
        const effect = resolveEffect(q.type);
        const amount = q.magnitude * q.confidence;

        const influences: HiddenStateInfluence[] = hiddenStateIds.map(hsId => ({
            id: randomUUID(), quantId: q.id, hiddenStateId: hsId, effect,
            amount, confidence: q.confidence,
            explanation: `${q.type} (${q.epistemic.status}) contributes ${effect} to hidden state`,
            createdAt: now,
        }));

        return {
            pluginName: manifest.name, pluginVersion: manifest.version, status: "success",
            output: influences, confidence: q.confidence, evidenceIds: q.sourceEventIds,
            warnings: [], errors: [], metrics: met(start),
            provenance: { source: "plugin", method: "type_based_effect", pluginName: manifest.name, pluginVersion: manifest.version, evidenceIds: q.sourceEventIds, createdAt: ctx.now },
        };
    },
    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
