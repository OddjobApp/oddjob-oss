import { randomUUID } from "crypto";
import type {
    PredictionPlugin, PluginManifest, PluginContext, PluginDecision, PluginResult, PluginHealth, PluginMetrics, Provenance,
} from "../../plugin-runtime/types.js";
import type { QuantInterferenceInput, QuantRelationship } from "../types.js";

// ============================================================================
// QUANT INTERFERENCE PLUGIN — Spec §16
// Detects conflicting quants. MVP: contradiction type + epistemic conflict.
// ============================================================================

const manifest: PluginManifest = {
    name: "quant-interference", version: "1.0.0", pod: "quant", subPod: "interference",
    capability: "quant.detect_interference", description: "Detects interfering quant pairs based on type conflict and epistemic divergence",
    owner: "prediction-intelligence", inputTypes: ["QuantInterferenceInput"], outputTypes: ["QuantRelationship[]"],
    execution: { type: "typescript_in_process", mode: "sync", latencyClass: "realtime", timeoutMs: 30, retryable: false, maxRetries: 0 },
    state: { readsState: false, writesState: false, stateKeys: [] },
    storage: { postgres: { read: false, write: false, tables: [] }, qdrant: { read: false, write: false, collections: [] }, redis: { read: false, write: false, keyPrefixes: [] }, objectStorage: { read: false, write: false, buckets: [] } },
    agents: { usesAgents: false, allowedForHotPath: true, maxAgentCalls: 0 },
    safety: { deterministic: true, requiresGovernance: false, producesAction: false, producesInference: true, producesPrediction: false, mayIncreaseRisk: false },
    dependencies: { requiredPlugins: [], optionalPlugins: [], externalServices: [] },
    rollout: { status: "active", trafficPercent: 100 },
};

function prov(ctx: PluginContext): Provenance {
    return { source: "plugin", method: "type_epistemic_conflict", pluginName: manifest.name, pluginVersion: manifest.version, evidenceIds: [], createdAt: ctx.now };
}
function met(start: string): PluginMetrics {
    const end = new Date().toISOString();
    return { startedAt: start, completedAt: end, durationMs: Date.parse(end) - Date.parse(start), dbReads: 0, dbWrites: 0, vectorQueries: 0, cacheReads: 0, cacheWrites: 0, agentCalls: 0, outputSizeBytes: 0 };
}

// Conflict pairs — types that directly oppose each other
const CONFLICT_PAIRS: [string, string][] = [
    ["resolution_signal", "contradiction_signal"],
    ["anomaly_signal", "pattern_signal"],
    ["hidden_state_signal", "absence_signal"],
];

function isConflictPair(typeA: string, typeB: string): boolean {
    return CONFLICT_PAIRS.some(([a, b]) => (typeA === a && typeB === b) || (typeA === b && typeB === a));
}

export const quantInterferencePlugin: PredictionPlugin<QuantInterferenceInput, QuantRelationship[]> = {
    manifest,
    async canHandle(input: QuantInterferenceInput): Promise<PluginDecision> {
        const ok = !!input?.quant?.id && Array.isArray(input?.candidates);
        return { shouldRun: ok, reason: ok ? "valid" : "missing input", priority: 70, estimatedCost: { latencyMs: 2, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },
    async execute(input: QuantInterferenceInput, ctx: PluginContext): Promise<PluginResult<QuantRelationship[]>> {
        const start = new Date().toISOString();
        const { quant: qi, candidates } = input;
        const now = ctx.now;

        const relationships: QuantRelationship[] = candidates
            .filter(qj => qj.id !== qi.id && qj.lifecycle.status === "active")
            .filter(qj => {
                const typeConflict = qi.type === "contradiction_signal" || qj.type === "contradiction_signal"
                    || isConflictPair(qi.type, qj.type);
                // Epistemic divergence: one known-known, other unknown-unknown = conflict
                const epistemicConflict =
                    (qi.epistemic.status === "known_known" && qj.epistemic.status === "unknown_unknown")
                    || (qi.epistemic.status === "unknown_unknown" && qj.epistemic.status === "known_known");
                // Same label root but different type = possible interference
                const labelRoot = qi.label?.split("_")[0];
                const labelConflict = labelRoot && qj.label?.startsWith(labelRoot) && qj.type !== qi.type;
                return typeConflict || epistemicConflict || !!labelConflict;
            })
            .map(qj => ({
                id: randomUUID(),
                sourceQuantId: qi.id,
                targetQuantId: qj.id,
                type: "interferes_with" as const,
                strength: (qi.uncertainty + qj.uncertainty) / 2,
                confidence: Math.min(qi.confidence, qj.confidence),
                evidenceIds: [...qi.sourceEventIds, ...qj.sourceEventIds],
                createdAt: now,
            }));

        return {
            pluginName: manifest.name, pluginVersion: manifest.version, status: "success",
            output: relationships, confidence: 1.0,
            evidenceIds: qi.sourceEventIds, warnings: [], errors: [],
            metrics: met(start), provenance: prov(ctx),
        };
    },
    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
