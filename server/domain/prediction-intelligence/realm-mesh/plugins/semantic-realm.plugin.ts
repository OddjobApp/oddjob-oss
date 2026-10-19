import { randomUUID } from "crypto";
import type {
    PluginManifest, PluginContext, PluginDecision, PluginResult, PluginHealth, PluginMetrics,
} from "../../plugin-runtime/types.js";
import type { RealmPlugin, QuantRealmInput, QuantRealmOutput } from "../types.js";
import type { RealmContribution } from "../../quant/types.js";

// ============================================================================
// SEMANTIC REALM PLUGIN — Spec §17 (MVP: label/type alignment heuristic)
// Full embedding-based version deferred to Phase 3.
// ============================================================================

const manifest: PluginManifest = {
    name: "semantic-realm", version: "1.0.0", pod: "realm-mesh", subPod: "semantic",
    capability: "semantic.label_alignment",
    description: "Analyzes quant meaning via label and type alignment (MVP label heuristic)",
    owner: "prediction-intelligence", inputTypes: ["QuantRealmInput"], outputTypes: ["QuantRealmOutput"],
    execution: { type: "typescript_in_process", mode: "sync", latencyClass: "realtime", timeoutMs: 15, retryable: false, maxRetries: 0 },
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

// Semantic weight by quant type — types more semantically meaningful score higher
const TYPE_SEMANTIC_WEIGHT: Record<string, number> = {
    semantic_signal: 1.0, hidden_state_signal: 0.9, pattern_signal: 0.85,
    causal_signal: 0.8, resolution_signal: 0.75, contradiction_signal: 0.7,
    anomaly_signal: 0.65, prediction_signal: 0.6,
    event_signal: 0.5, absence_signal: 0.45,
    temporal_signal: 0.4, geographic_signal: 0.35, spatial_signal: 0.35,
};

function extractConcept(label?: string): string {
    if (!label) return "unknown";
    // Strip _signal suffix and replace underscores
    return label.replace(/_signal$/, "").replace(/_/g, " ").trim();
}

export const semanticRealmPlugin: RealmPlugin<QuantRealmInput, QuantRealmOutput> = {
    manifest,
    realm: "semantic" as const,
    async canHandle(input: QuantRealmInput): Promise<PluginDecision> {
        return { shouldRun: !!input?.quant?.id, reason: input?.quant?.id ? "valid" : "missing quant", priority: 80, estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },
    async execute(input: QuantRealmInput, ctx: PluginContext): Promise<PluginResult<QuantRealmOutput>> {
        const start = new Date().toISOString();
        const { quant } = input;
        const semanticWeight = TYPE_SEMANTIC_WEIGHT[quant.type] ?? 0.5;
        const concept = extractConcept(quant.label);
        const effect: RealmContribution["effect"] = semanticWeight > 0.7 ? "boost" : semanticWeight < 0.4 ? "preserve" : "explain";

        const contributions: RealmContribution[] = [{
            id: randomUUID(), contextId: quant.contextId, quantId: quant.id,
            realm: "semantic", pluginName: manifest.name, pluginVersion: manifest.version,
            effect, targetType: "quant", targetId: quant.id,
            amount: semanticWeight * quant.confidence,
            confidence: 0.7, // MVP heuristic confidence
            uncertaintyDelta: semanticWeight > 0.7 ? -0.05 : 0,
            entropyDelta: 0,
            evidenceIds: quant.sourceEventIds,
            explanation: `Semantic concept '${concept}' from type '${quant.type}' (weight=${semanticWeight.toFixed(2)})`,
            metadata: { concept, type: quant.type, semanticWeight },
            provenance: { sourceSystem: manifest.name, sourceId: quant.type, ingestedAt: ctx.now, createdBy: "semantic-realm" },
            createdAt: ctx.now,
        }];

        const output: QuantRealmOutput = {
            quantId: quant.id, realm: "semantic",
            contributions, branchInfluences: [], hiddenStateInfluences: [], relationships: [], warnings: [],
        };
        return {
            pluginName: manifest.name, pluginVersion: manifest.version, status: "success",
            output, confidence: 0.7, evidenceIds: quant.sourceEventIds, warnings: [], errors: [], metrics: met(start),
            provenance: { source: "plugin", method: "semantic_analysis", pluginName: manifest.name, pluginVersion: manifest.version, evidenceIds: quant.sourceEventIds, createdAt: ctx.now },
        };
    },
    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
