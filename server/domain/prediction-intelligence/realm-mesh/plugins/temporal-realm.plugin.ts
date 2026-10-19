import { randomUUID } from "crypto";
import type {
    PluginManifest, PluginContext, PluginDecision, PluginResult, PluginHealth, PluginMetrics,
} from "../../plugin-runtime/types.js";
import type { RealmPlugin, QuantRealmInput, QuantRealmOutput } from "../types.js";
import type { RealmContribution } from "../../quant/types.js";

// ============================================================================
// TEMPORAL REALM PLUGIN — Spec §16
// Analyzes time structure: recency, frequency, burst, absence.
// MVP: recency score + burst flag via exponential decay + rate heuristic.
// ============================================================================

const manifest: PluginManifest = {
    name: "temporal-realm", version: "1.0.0", pod: "realm-mesh", subPod: "temporal",
    capability: "temporal.recency",
    description: "Computes temporal recency, frequency, and burst contributions for quants",
    owner: "prediction-intelligence", inputTypes: ["QuantRealmInput"], outputTypes: ["QuantRealmOutput"],
    execution: { type: "typescript_in_process", mode: "sync", latencyClass: "realtime", timeoutMs: 25, retryable: false, maxRetries: 0 },
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

// λ = 0.00001 → half-life ≈ 19 hours
const LAMBDA = 0.00001;
const BURST_WINDOW_EVENTS = 3;
const BURST_BOOST = 0.15;

export const temporalRealmPlugin: RealmPlugin<QuantRealmInput, QuantRealmOutput> = {
    manifest,
    realm: "temporal" as const,
    async canHandle(input: QuantRealmInput): Promise<PluginDecision> {
        return { shouldRun: !!input?.quant?.id, reason: input?.quant?.id ? "valid" : "missing quant", priority: 90, estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },
    async execute(input: QuantRealmInput, ctx: PluginContext): Promise<PluginResult<QuantRealmOutput>> {
        const start = new Date().toISOString();
        const { quant, activeWindows } = input;
        const nowMs = Date.parse(ctx.now);
        const createdMs = Date.parse(quant.createdAt);
        const ageMs = Math.max(0, nowMs - createdMs);

        // spec §16: recency via exponential decay
        const recency = Math.exp(-LAMBDA * ageMs);
        const effect: RealmContribution["effect"] = recency > 0.5 ? "boost" : recency < 0.1 ? "suppress" : "preserve";

        // Burst detection: many events in the active window → boost
        const totalWindowEvents = activeWindows.reduce((s, w) => s + w.eventCount, 0);
        const isBurst = totalWindowEvents >= BURST_WINDOW_EVENTS;

        const contributions: RealmContribution[] = [
            {
                id: randomUUID(), contextId: quant.contextId, quantId: quant.id,
                realm: "temporal", pluginName: manifest.name, pluginVersion: manifest.version,
                effect, targetType: "quant", targetId: quant.id,
                amount: recency, confidence: 1.0, uncertaintyDelta: 0,
                entropyDelta: recency < 0.3 ? 0.05 : 0,
                evidenceIds: quant.sourceEventIds,
                explanation: `Temporal recency=${recency.toFixed(3)} (age=${Math.round(ageMs / 1000)}s)`,
                metadata: { ageMs, recency, isBurst },
                provenance: { sourceSystem: manifest.name, sourceId: manifest.version, ingestedAt: ctx.now, createdBy: "temporal-realm" },
                createdAt: ctx.now,
            },
        ];

        if (isBurst) {
            contributions.push({
                id: randomUUID(), contextId: quant.contextId, quantId: quant.id,
                realm: "temporal", pluginName: manifest.name, pluginVersion: manifest.version,
                effect: "boost", targetType: "quant", targetId: quant.id,
                amount: BURST_BOOST, confidence: 0.7, uncertaintyDelta: -0.05, entropyDelta: -0.03,
                evidenceIds: quant.sourceEventIds,
                explanation: `Burst detected: ${totalWindowEvents} events in active windows`,
                metadata: { windowEventCount: totalWindowEvents },
                provenance: { sourceSystem: manifest.name, sourceId: "burst", ingestedAt: ctx.now, createdBy: "temporal-realm" },
                createdAt: ctx.now,
            });
        }

        const output: QuantRealmOutput = {
            quantId: quant.id, realm: "temporal",
            contributions, branchInfluences: [], hiddenStateInfluences: [], relationships: [], warnings: [],
        };
        return {
            pluginName: manifest.name, pluginVersion: manifest.version, status: "success",
            output, confidence: 1.0, evidenceIds: quant.sourceEventIds, warnings: [], errors: [], metrics: met(start),
            provenance: { source: "plugin", method: "temporal_analysis", pluginName: manifest.name, pluginVersion: manifest.version, evidenceIds: quant.sourceEventIds, createdAt: ctx.now },
        };
    },
    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
