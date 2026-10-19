import { randomUUID } from "crypto";
import type {
    PluginManifest, PluginContext, PluginDecision, PluginResult, PluginHealth, PluginMetrics,
} from "../../plugin-runtime/types.js";
import type { RealmPlugin, QuantRealmInput, QuantRealmOutput } from "../types.js";
import type { RealmContribution } from "../../quant/types.js";
import { EPSILON } from "../../quant/types.js";

// ============================================================================
// ATTENTION REALM PLUGIN — Spec §24
// Determines salience and priority. Computes spec §29.1 influence score.
// ============================================================================

const manifest: PluginManifest = {
    name: "attention-realm", version: "1.0.0", pod: "realm-mesh", subPod: "attention",
    capability: "attention.score_salience",
    description: "Assigns attention and priority scores based on quant influence and magnitude",
    owner: "prediction-intelligence", inputTypes: ["QuantRealmInput"], outputTypes: ["QuantRealmOutput"],
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

// High-attention types that should receive compute priority
const HIGH_ATTENTION_TYPES = new Set(["anomaly_signal", "hidden_state_signal", "contradiction_signal", "resolution_signal"]);

export const attentionRealmPlugin: RealmPlugin<QuantRealmInput, QuantRealmOutput> = {
    manifest,
    realm: "attention" as const,
    async canHandle(input: QuantRealmInput): Promise<PluginDecision> {
        return { shouldRun: !!input?.quant?.id, reason: input?.quant?.id ? "valid" : "missing quant", priority: 75, estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },
    async execute(input: QuantRealmInput, ctx: PluginContext): Promise<PluginResult<QuantRealmOutput>> {
        const start = new Date().toISOString();
        const { quant } = input;
        const ep = quant.epistemic;

        // spec §29.1: influence = magnitude × confidence × maturity / max(uncertainty, ε)
        const maturity = ep.evidenceStrength * ep.recognitionLevel * ep.resolutionLevel;
        const influence = (quant.magnitude * quant.confidence * Math.max(maturity, 0.01)) / Math.max(quant.uncertainty, EPSILON);
        const attentionScore = Math.min(1, influence);
        const isHighAttention = HIGH_ATTENTION_TYPES.has(quant.type) || attentionScore > 0.7;
        const effect: RealmContribution["effect"] = isHighAttention ? "boost" : attentionScore < 0.1 ? "suppress" : "preserve";

        const contributions: RealmContribution[] = [{
            id: randomUUID(), contextId: quant.contextId, quantId: quant.id,
            realm: "attention", pluginName: manifest.name, pluginVersion: manifest.version,
            effect, targetType: "quant", targetId: quant.id,
            amount: attentionScore, confidence: 1.0,
            uncertaintyDelta: 0, entropyDelta: 0,
            evidenceIds: quant.sourceEventIds,
            explanation: `Attention score=${attentionScore.toFixed(3)} influence=${influence.toFixed(3)} highAttention=${isHighAttention}`,
            metadata: { attentionScore, influence, isHighAttention, type: quant.type },
            provenance: { sourceSystem: manifest.name, sourceId: quant.type, ingestedAt: ctx.now, createdBy: "attention-realm" },
            createdAt: ctx.now,
        }];

        const output: QuantRealmOutput = { quantId: quant.id, realm: "attention", contributions, branchInfluences: [], hiddenStateInfluences: [], relationships: [], warnings: [] };
        return {
            pluginName: manifest.name, pluginVersion: manifest.version, status: "success",
            output, confidence: 1.0, evidenceIds: quant.sourceEventIds, warnings: [], errors: [], metrics: met(start),
            provenance: { source: "plugin", method: "attention_scoring", pluginName: manifest.name, pluginVersion: manifest.version, evidenceIds: quant.sourceEventIds, createdAt: ctx.now },
        };
    },
    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
