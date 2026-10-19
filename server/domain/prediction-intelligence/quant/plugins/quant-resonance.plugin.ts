import { randomUUID } from "crypto";
import type {
    PredictionPlugin, PluginManifest, PluginContext, PluginDecision, PluginResult, PluginHealth, PluginMetrics, Provenance,
} from "../../plugin-runtime/types.js";
import type { QuantResonanceInput, QuantRelationship } from "../types.js";

// ============================================================================
// QUANT RESONANCE PLUGIN — Spec §15
// Detects quants that mutually reinforce each other.
// MVP: label + epistemic-trajectory alignment heuristic.
// Full resonance formula deferred to Phase 3 (embedding-based).
// ============================================================================

const manifest: PluginManifest = {
    name: "quant-resonance", version: "1.0.0", pod: "quant", subPod: "resonance",
    capability: "quant.detect_resonance", description: "Detects resonant quant pairs using label and epistemic alignment",
    owner: "prediction-intelligence", inputTypes: ["QuantResonanceInput"], outputTypes: ["QuantRelationship[]"],
    execution: { type: "typescript_in_process", mode: "sync", latencyClass: "realtime", timeoutMs: 30, retryable: false, maxRetries: 0 },
    state: { readsState: false, writesState: false, stateKeys: [] },
    storage: { postgres: { read: false, write: false, tables: [] }, qdrant: { read: false, write: false, collections: [] }, redis: { read: false, write: false, keyPrefixes: [] }, objectStorage: { read: false, write: false, buckets: [] } },
    agents: { usesAgents: false, allowedForHotPath: true, maxAgentCalls: 0 },
    safety: { deterministic: true, requiresGovernance: false, producesAction: false, producesInference: true, producesPrediction: false, mayIncreaseRisk: false },
    dependencies: { requiredPlugins: [], optionalPlugins: [], externalServices: [] },
    rollout: { status: "active", trafficPercent: 100 },
};

function prov(ctx: PluginContext): Provenance {
    return { source: "plugin", method: "label_epistemic_alignment", pluginName: manifest.name, pluginVersion: manifest.version, evidenceIds: [], createdAt: ctx.now };
}
function met(start: string): PluginMetrics {
    const end = new Date().toISOString();
    return { startedAt: start, completedAt: end, durationMs: Date.parse(end) - Date.parse(start), dbReads: 0, dbWrites: 0, vectorQueries: 0, cacheReads: 0, cacheWrites: 0, agentCalls: 0, outputSizeBytes: 0 };
}

export const quantResonancePlugin: PredictionPlugin<QuantResonanceInput, QuantRelationship[]> = {
    manifest,
    async canHandle(input: QuantResonanceInput): Promise<PluginDecision> {
        const ok = !!input?.quant?.id && Array.isArray(input?.candidates);
        return { shouldRun: ok, reason: ok ? "valid" : "missing quant or candidates", priority: 70, estimatedCost: { latencyMs: 2, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },
    async execute(input: QuantResonanceInput, ctx: PluginContext): Promise<PluginResult<QuantRelationship[]>> {
        const start = new Date().toISOString();
        const { quant: qi, candidates } = input;
        const now = ctx.now;

        const relationships: QuantRelationship[] = candidates
            .filter(qj => qj.id !== qi.id && qj.lifecycle.status === "active")
            .filter(qj => {
                // spec §15: resonance formula simplified to semantic + epistemic alignment
                const sameType = qj.type === qi.type;
                const labelRoot = qi.label?.split("_")[0];
                const labelMatch = labelRoot && qj.label?.startsWith(labelRoot);
                const epistemicMatch = qi.epistemic.status === qj.epistemic.status;
                // At least 2 of 3 must align for resonance
                return (sameType ? 1 : 0) + (labelMatch ? 1 : 0) + (epistemicMatch ? 1 : 0) >= 2;
            })
            .map(qj => ({
                id: randomUUID(),
                sourceQuantId: qi.id,
                targetQuantId: qj.id,
                type: "resonates_with" as const,
                strength: (qi.confidence + qj.confidence) / 2,
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
