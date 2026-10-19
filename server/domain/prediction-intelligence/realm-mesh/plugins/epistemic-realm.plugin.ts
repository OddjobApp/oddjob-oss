import { randomUUID } from "crypto";
import type {
    PluginManifest, PluginContext, PluginDecision, PluginResult, PluginHealth, PluginMetrics,
} from "../../plugin-runtime/types.js";
import type { RealmPlugin, QuantRealmInput, QuantRealmOutput } from "../types.js";
import type { RealmContribution } from "../../quant/types.js";

// ============================================================================
// EPISTEMIC REALM PLUGIN — Spec §22
// Analyzes what the system knows/doesn't know about each quant.
// ============================================================================

const manifest: PluginManifest = {
    name: "epistemic-realm", version: "1.0.0", pod: "realm-mesh", subPod: "epistemic",
    capability: "epistemic.analyze_knownness",
    description: "Analyzes epistemic status and knownness trajectory for quants",
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

// Epistemic status → effect and uncertainty delta mapping
const STATUS_MAP: Record<string, { effect: RealmContribution["effect"]; uncertaintyDelta: number; entropyDelta: number }> = {
    known_known:     { effect: "boost",            uncertaintyDelta: -0.10, entropyDelta: -0.08 },
    known_unknown:   { effect: "increase_entropy", uncertaintyDelta: +0.05, entropyDelta: +0.05 },
    unknown_known:   { effect: "explain",          uncertaintyDelta: +0.02, entropyDelta: +0.02 },
    unknown_unknown: { effect: "warn",             uncertaintyDelta: +0.15, entropyDelta: +0.10 },
};

export const epistemicRealmPlugin: RealmPlugin<QuantRealmInput, QuantRealmOutput> = {
    manifest,
    realm: "epistemic" as const,
    async canHandle(input: QuantRealmInput): Promise<PluginDecision> {
        return { shouldRun: !!input?.quant?.id, reason: input?.quant?.id ? "valid" : "missing quant", priority: 85, estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },
    async execute(input: QuantRealmInput, ctx: PluginContext): Promise<PluginResult<QuantRealmOutput>> {
        const start = new Date().toISOString();
        const { quant } = input;
        const ep = quant.epistemic;
        const mapping = STATUS_MAP[ep.status] ?? STATUS_MAP.unknown_unknown;

        // Epistemic maturity = evidenceStrength × recognitionLevel × resolutionLevel
        const maturity = ep.evidenceStrength * ep.recognitionLevel * ep.resolutionLevel;
        const amount = quant.magnitude * quant.confidence * Math.max(maturity, 0.01);

        const contributions: RealmContribution[] = [{
            id: randomUUID(), contextId: quant.contextId, quantId: quant.id,
            realm: "epistemic", pluginName: manifest.name, pluginVersion: manifest.version,
            effect: mapping.effect, targetType: "quant", targetId: quant.id,
            amount, confidence: quant.confidence,
            uncertaintyDelta: mapping.uncertaintyDelta,
            entropyDelta: mapping.entropyDelta,
            evidenceIds: quant.sourceEventIds,
            explanation: `Epistemic status=${ep.status} maturity=${maturity.toFixed(3)} (world=${ep.worldKnownness.toFixed(2)}, system=${ep.systemKnownness.toFixed(2)})`,
            metadata: { status: ep.status, maturity, worldKnownness: ep.worldKnownness, systemKnownness: ep.systemKnownness },
            provenance: { sourceSystem: manifest.name, sourceId: ep.status, ingestedAt: ctx.now, createdBy: "epistemic-realm" },
            createdAt: ctx.now,
        }];

        const warnings = ep.status === "unknown_unknown" ? [{
            realm: "epistemic" as const, code: "UNKNOWN_UNKNOWN",
            severity: "medium" as const,
            message: `Quant ${quant.id} is unknown_unknown — consider evidence gathering`,
            evidenceIds: quant.sourceEventIds,
        }] : [];

        const output: QuantRealmOutput = { quantId: quant.id, realm: "epistemic", contributions, branchInfluences: [], hiddenStateInfluences: [], relationships: [], warnings };
        return {
            pluginName: manifest.name, pluginVersion: manifest.version, status: "success",
            output, confidence: quant.confidence, evidenceIds: quant.sourceEventIds, warnings: [], errors: [], metrics: met(start),
            provenance: { source: "plugin", method: "epistemic_analysis", pluginName: manifest.name, pluginVersion: manifest.version, evidenceIds: quant.sourceEventIds, createdAt: ctx.now },
        };
    },
    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
