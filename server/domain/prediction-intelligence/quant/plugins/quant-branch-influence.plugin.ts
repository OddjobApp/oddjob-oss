import { randomUUID } from "crypto";
import type {
    PredictionPlugin, PluginManifest, PluginContext, PluginDecision, PluginResult, PluginHealth, PluginMetrics,
} from "../../plugin-runtime/types.js";
import type { QuantSingleBranchInfluenceInput, BranchInfluence } from "../types.js";
import { EPSILON } from "../types.js";

// ============================================================================
// QUANT BRANCH INFLUENCE PLUGIN — Spec §18
// Translates quant evidence into branch effects using spec §29.1 formula.
// ============================================================================

const manifest: PluginManifest = {
    name: "quant-branch-influence", version: "1.0.0", pod: "quant", subPod: "branch-influence",
    capability: "quant.influence_branches",
    description: "Computes branch boost/suppress/split/preserve/collapse from quant state",
    owner: "prediction-intelligence",
    inputTypes: ["QuantSingleBranchInfluenceInput"], outputTypes: ["BranchInfluence[]"],
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

export const quantBranchInfluencePlugin: PredictionPlugin<QuantSingleBranchInfluenceInput, BranchInfluence[]> = {
    manifest,
    async canHandle(input: QuantSingleBranchInfluenceInput): Promise<PluginDecision> {
        const ok = !!input?.quant?.id && Array.isArray(input?.branchIds) && input.branchIds.length > 0;
        return { shouldRun: ok, reason: ok ? "valid" : "missing quant or branchIds", priority: 65, estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },
    async execute(input: QuantSingleBranchInfluenceInput, ctx: PluginContext): Promise<PluginResult<BranchInfluence[]>> {
        const start = new Date().toISOString();
        const { quant: q, branchIds } = input;

        if (q.lifecycle.status !== "active" && q.lifecycle.status !== "decaying") {
            return {
                pluginName: manifest.name, pluginVersion: manifest.version, status: "skipped",
                confidence: 0, evidenceIds: [], warnings: [], errors: [],
                metrics: met(start),
                provenance: { source: "plugin", method: "quant_influence_score", pluginName: manifest.name, pluginVersion: manifest.version, evidenceIds: [], createdAt: ctx.now },
            };
        }

        // spec §29.1: influence = magnitude × confidence × epistemic_maturity / max(uncertainty, ε)
        const epistemicMaturity = q.epistemic.evidenceStrength * q.epistemic.recognitionLevel * q.epistemic.resolutionLevel;
        const influence = (q.magnitude * q.confidence * epistemicMaturity) / Math.max(q.uncertainty, EPSILON);

        const now = ctx.now;
        const influences: BranchInfluence[] = branchIds.map(branchId => {
            let effect: BranchInfluence["effect"] = "preserve";
            if (q.type === "contradiction_signal") effect = "suppress";
            else if (q.type === "resolution_signal") effect = "collapse";
            else if (q.type === "anomaly_signal") effect = "split";
            else if (influence > 0.5) effect = "boost";
            return {
                id: randomUUID(),
                quantId: q.id, branchId, effect,
                amount: Math.min(1, influence),
                confidence: q.confidence,
                explanation: `${q.type} magnitude=${q.magnitude.toFixed(3)} epistemic=${q.epistemic.status}`,
                createdAt: now,
            };
        });

        return {
            pluginName: manifest.name, pluginVersion: manifest.version, status: "success",
            output: influences, confidence: q.confidence, evidenceIds: q.sourceEventIds,
            warnings: [], errors: [], metrics: met(start),
            provenance: { source: "plugin", method: "quant_influence_score", pluginName: manifest.name, pluginVersion: manifest.version, evidenceIds: q.sourceEventIds, createdAt: ctx.now },
        };
    },
    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
