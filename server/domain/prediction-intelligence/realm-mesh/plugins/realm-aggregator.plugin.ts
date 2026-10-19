import { randomUUID } from "crypto";
import type {
    PredictionPlugin, PluginManifest, PluginContext, PluginDecision, PluginResult, PluginHealth, PluginMetrics,
} from "../../plugin-runtime/types.js";
import type { QuantRealmOutput } from "../types.js";
import type { RealmContribution, RealmName } from "../../quant/types.js";

// ============================================================================
// REALM AGGREGATOR PLUGIN — Spec §28
// Collects all realm outputs and normalizes contribution amounts.
// ============================================================================

export interface RealmAggregatorInput {
    contextId: string;
    quantId: string;
    realmOutputs: QuantRealmOutput[];
}

export interface RealmAggregatorOutput {
    contextId: string;
    quantId: string;
    contributions: RealmContribution[];
    totalEntropyDelta: number;
    totalUncertaintyDelta: number;
    realmCount: number;
}

const manifest: PluginManifest = {
    name: "realm-aggregator", version: "1.0.0", pod: "realm-mesh", subPod: "aggregator",
    capability: "realm.aggregate_contributions",
    description: "Aggregates and normalizes realm contributions with bounded entropy deltas",
    owner: "prediction-intelligence", inputTypes: ["RealmAggregatorInput"], outputTypes: ["RealmAggregatorOutput"],
    execution: { type: "typescript_in_process", mode: "sync", latencyClass: "realtime", timeoutMs: 20, retryable: false, maxRetries: 0 },
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

/** Normalize amounts to [0,1] via max-normalization. Preserves confidence. */
function normalizeContributions(contribs: RealmContribution[]): RealmContribution[] {
    const maxAmount = Math.max(...contribs.map(c => Math.abs(c.amount)), 1e-9);
    return contribs.map(c => ({ ...c, amount: c.amount / maxAmount }));
}

export const realmAggregatorPlugin: PredictionPlugin<RealmAggregatorInput, RealmAggregatorOutput> = {
    manifest,
    async canHandle(input: RealmAggregatorInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && Array.isArray(input?.realmOutputs);
        return { shouldRun: ok, reason: ok ? "valid" : "missing contextId or realmOutputs", priority: 50, estimatedCost: { latencyMs: 2, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },
    async execute(input: RealmAggregatorInput, ctx: PluginContext): Promise<PluginResult<RealmAggregatorOutput>> {
        const start = new Date().toISOString();
        const { contextId, quantId, realmOutputs } = input;

        // Collect all contributions from all realm outputs
        const allContribs: RealmContribution[] = realmOutputs.flatMap(o => o.contributions);

        // Normalize amounts (spec §28: bounded common range)
        const normalized = normalizeContributions(allContribs);

        // Bound entropy deltas (spec §28: additive but bounded)
        const totalEntropyDelta = Math.max(-0.5, Math.min(0.5, normalized.reduce((s, c) => s + c.entropyDelta, 0)));
        const totalUncertaintyDelta = Math.max(-0.5, Math.min(0.5, normalized.reduce((s, c) => s + c.uncertaintyDelta, 0)));

        const output: RealmAggregatorOutput = {
            contextId, quantId, contributions: normalized,
            totalEntropyDelta, totalUncertaintyDelta,
            realmCount: new Set(normalized.map(c => c.realm)).size,
        };

        return {
            pluginName: manifest.name, pluginVersion: manifest.version, status: "success",
            output, confidence: 1.0, evidenceIds: [], warnings: [], errors: [], metrics: met(start),
            provenance: { source: "plugin", method: "max_normalization", pluginName: manifest.name, pluginVersion: manifest.version, evidenceIds: [], createdAt: ctx.now },
        };
    },
    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
