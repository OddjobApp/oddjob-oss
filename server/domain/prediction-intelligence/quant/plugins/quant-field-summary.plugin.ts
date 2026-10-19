import { randomUUID } from "crypto";
import type {
    PredictionPlugin, PluginManifest, PluginContext, PluginDecision, PluginResult, PluginHealth, PluginMetrics, Provenance,
} from "../../plugin-runtime/types.js";
import type { QuantFieldSummaryInput, QuantFieldSummary, EpistemicStatus, Quant } from "../types.js";

const manifest: PluginManifest = {
    name: "quant-field-summary", version: "1.0.0", pod: "quant", subPod: "field",
    capability: "quant.summarize_field",
    description: "Computes field density, entropy, alignment, coherence, and collapse probability",
    owner: "prediction-intelligence",
    inputTypes: ["QuantFieldSummaryInput"], outputTypes: ["QuantFieldSummary"],
    execution: { type: "typescript_in_process", mode: "sync", latencyClass: "realtime", timeoutMs: 25, retryable: false, maxRetries: 0 },
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

export function computeField(quants: Quant[], contextId: string, windowId?: string, now = new Date().toISOString()): QuantFieldSummary {
    const active = quants.filter(q => q.lifecycle.status === "active" || q.lifecycle.status === "decaying");
    const count = active.length;

    if (count === 0) {
        return { id: randomUUID(), contextId, windowId, quantCount: 0, fieldDensity: 0, fieldMomentum: [0], fieldEntropy: 0, fieldAlignment: 1, fieldDivergence: 0, fieldCoherence: 1, epistemicCenterOfMass: [0, 0, 0], dominantStatus: "unknown_unknown", topAttractors: [], collapseProbability: 0, createdAt: now };
    }

    const fieldDensity = active.reduce((s, q) => s + q.magnitude, 0) / count;
    const fieldEntropy = Math.min(1, active.reduce((s, q) => s + q.entropyContribution, 0) / count);
    const fieldAlignment = active.reduce((s, q) => s + q.confidence, 0) / count;
    const fieldDivergence = active.reduce((s, q) => s + q.uncertainty, 0) / count;
    const fieldCoherence = fieldAlignment * (1 - fieldEntropy); // spec §29.3
    const com = [0, 0, 0];
    active.forEach(q => {
        com[0] += q.epistemic.worldKnownness / count;
        com[1] += q.epistemic.systemKnownness / count;
        com[2] += q.epistemic.resolutionLevel / count;
    });
    const fieldMomentum = [active.reduce((s, q) => s + (q.trajectory.velocity[0] ?? 0), 0) / count];
    const statusCounts: Record<string, number> = {};
    active.forEach(q => { statusCounts[q.epistemic.status] = (statusCounts[q.epistemic.status] ?? 0) + 1; });
    const dominantStatus = (Object.entries(statusCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown_unknown") as EpistemicStatus;
    const collapseProbability = Math.min(1, fieldCoherence * (1 - fieldEntropy) * fieldAlignment * fieldAlignment); // spec §29.4

    return { id: randomUUID(), contextId, windowId, quantCount: count, fieldDensity, fieldMomentum, fieldEntropy, fieldAlignment, fieldDivergence, fieldCoherence, epistemicCenterOfMass: com, dominantStatus, topAttractors: [], collapseProbability, createdAt: now };
}

export const quantFieldSummaryPlugin: PredictionPlugin<QuantFieldSummaryInput, QuantFieldSummary> = {
    manifest,
    async canHandle(input: QuantFieldSummaryInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && Array.isArray(input?.quants);
        return { shouldRun: ok, reason: ok ? "valid" : "missing contextId or quants", priority: 60, estimatedCost: { latencyMs: 3, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },
    async execute(input: QuantFieldSummaryInput, ctx: PluginContext): Promise<PluginResult<QuantFieldSummary>> {
        const start = new Date().toISOString();
        const summary = computeField(input.quants, input.contextId, input.windowId, ctx.now);
        return {
            pluginName: manifest.name, pluginVersion: manifest.version, status: "success",
            output: summary, confidence: 1.0, evidenceIds: [], warnings: [], errors: [],
            metrics: met(start),
            provenance: { source: "plugin", method: "field_aggregation", pluginName: manifest.name, pluginVersion: manifest.version, evidenceIds: [], createdAt: ctx.now },
        };
    },
    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
