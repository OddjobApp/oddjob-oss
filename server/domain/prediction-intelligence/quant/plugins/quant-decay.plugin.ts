import type {
    PredictionPlugin, PluginManifest, PluginContext, PluginDecision, PluginResult, PluginHealth, PluginMetrics,
} from "../../plugin-runtime/types.js";
import type { QuantDecayInput, QuantDecayOutput, QuantLifecycle } from "../types.js";

// ============================================================================
// QUANT DECAY PLUGIN — Spec §20
// Formula: magnitude_t = magnitude_0 × exp(-λ Δt) + reinforcement
// ============================================================================

const manifest: PluginManifest = {
    name: "quant-decay", version: "1.0.0", pod: "quant", subPod: "decay",
    capability: "quant.apply_decay",
    description: "Applies exponential decay to quant magnitude and updates lifecycle status",
    owner: "prediction-intelligence",
    inputTypes: ["QuantDecayInput"], outputTypes: ["QuantDecayOutput"],
    execution: { type: "typescript_in_process", mode: "sync", latencyClass: "realtime", timeoutMs: 10, retryable: false, maxRetries: 0 },
    state: { readsState: false, writesState: false, stateKeys: [] },
    storage: { postgres: { read: false, write: false, tables: [] }, qdrant: { read: false, write: false, collections: [] }, redis: { read: false, write: false, keyPrefixes: [] }, objectStorage: { read: false, write: false, buckets: [] } },
    agents: { usesAgents: false, allowedForHotPath: true, maxAgentCalls: 0 },
    safety: { deterministic: true, requiresGovernance: false, producesAction: false, producesInference: false, producesPrediction: false, mayIncreaseRisk: false },
    dependencies: { requiredPlugins: [], optionalPlugins: [], externalServices: [] },
    rollout: { status: "active", trafficPercent: 100 },
};

function met(start: string): PluginMetrics {
    const end = new Date().toISOString();
    return { startedAt: start, completedAt: end, durationMs: Date.parse(end) - Date.parse(start), dbReads: 0, dbWrites: 0, vectorQueries: 0, cacheReads: 0, cacheWrites: 0, agentCalls: 0, outputSizeBytes: 0 };
}

export const quantDecayPlugin: PredictionPlugin<QuantDecayInput, QuantDecayOutput> = {
    manifest,
    async canHandle(input: QuantDecayInput): Promise<PluginDecision> {
        const ok = !!input?.quant?.id && input?.nowMs > 0;
        return { shouldRun: ok && input.quant.lifecycle.decayRate > 0, reason: ok ? "valid" : "missing quant or nowMs", priority: 50, estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },
    async execute(input: QuantDecayInput, ctx: PluginContext): Promise<PluginResult<QuantDecayOutput>> {
        const start = new Date().toISOString();
        const { quant, nowMs, reinforcement = 0 } = input;

        const createdMs = new Date(quant.createdAt).getTime();
        const deltaSeconds = (nowMs - createdMs) / 1000;
        // spec §20: magnitude_t = magnitude_0 × exp(-λ Δt) + reinforcement
        const newMagnitude = Math.max(0, quant.magnitude * Math.exp(-quant.lifecycle.decayRate * deltaSeconds) + reinforcement);

        let lifecycleStatus = quant.lifecycle.status;
        if (newMagnitude < 0.05 && lifecycleStatus === "decaying") lifecycleStatus = "archived";
        else if (newMagnitude < quant.magnitude * 0.5 && lifecycleStatus === "active") lifecycleStatus = "decaying";

        const lifecycle: QuantLifecycle = { ...quant.lifecycle, status: lifecycleStatus };

        return {
            pluginName: manifest.name, pluginVersion: manifest.version, status: "success",
            output: { magnitude: newMagnitude, lifecycle }, confidence: 1.0,
            evidenceIds: quant.sourceEventIds, warnings: [], errors: [], metrics: met(start),
            provenance: { source: "plugin", method: "exponential_decay", pluginName: manifest.name, pluginVersion: manifest.version, evidenceIds: quant.sourceEventIds, createdAt: ctx.now },
        };
    },
    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
