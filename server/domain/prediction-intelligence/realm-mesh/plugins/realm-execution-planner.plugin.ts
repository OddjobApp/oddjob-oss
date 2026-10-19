import { randomUUID } from "crypto";
import type {
    PredictionPlugin, PluginManifest, PluginContext, PluginDecision, PluginResult, PluginHealth, PluginMetrics,
} from "../../plugin-runtime/types.js";
import type { RealmExecutionPlan, RealmQuantProcessingInput } from "../types.js";

// ============================================================================
// REALM EXECUTION PLANNER PLUGIN — Spec §26
// Determines which realms run, in what order, for a given mode.
// ============================================================================

// Mode→realm plan per spec §27
const MODE_PLANS: Record<string, Array<import("../../quant/types.js").RealmName>> = {
    realtime:    ["temporal", "epistemic", "attention", "governance_awareness"],
    interactive: ["temporal", "semantic", "epistemic", "attention", "geometric", "pattern"],
    analysis:    ["temporal", "semantic", "causal", "epistemic", "attention", "geometric", "pattern", "geographic", "spatial", "governance_awareness"],
    batch:       ["temporal", "semantic", "causal", "epistemic", "attention", "geometric", "pattern", "geographic", "spatial", "governance_awareness"],
};

// Parallel groups — can run concurrently (spec §27)
const PARALLEL_GROUPS: Record<string, Array<Array<import("../../quant/types.js").RealmName>>> = {
    realtime:    [["temporal", "epistemic", "attention"]],
    interactive: [["temporal", "epistemic"], ["semantic", "attention"], ["geometric", "pattern"]],
    analysis:    [["temporal", "epistemic"], ["semantic", "causal"], ["attention", "governance_awareness"], ["geometric", "pattern"], ["geographic", "spatial"]],
    batch:       [["temporal", "epistemic"], ["semantic", "causal"], ["attention", "governance_awareness"], ["geometric", "pattern", "geographic", "spatial"]],
};

const MODE_TIMEOUTS: Record<string, number> = {
    realtime: 100, interactive: 500, analysis: 3000, batch: 30000,
};

const manifest: PluginManifest = {
    name: "realm-execution-planner", version: "1.0.0", pod: "realm-mesh", subPod: "planner",
    capability: "realm.plan_execution",
    description: "Determines realm execution order, parallel groups, and timeouts per mode",
    owner: "prediction-intelligence", inputTypes: ["RealmQuantProcessingInput"], outputTypes: ["RealmExecutionPlan"],
    execution: { type: "typescript_in_process", mode: "sync", latencyClass: "realtime", timeoutMs: 5, retryable: false, maxRetries: 0 },
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

export const realmExecutionPlannerPlugin: PredictionPlugin<RealmQuantProcessingInput, RealmExecutionPlan> = {
    manifest,
    async canHandle(input: RealmQuantProcessingInput): Promise<PluginDecision> {
        return { shouldRun: !!input?.mode, reason: input?.mode ? "valid" : "missing mode", priority: 100, estimatedCost: { latencyMs: 0, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },
    async execute(input: RealmQuantProcessingInput, ctx: PluginContext): Promise<PluginResult<RealmExecutionPlan>> {
        const start = new Date().toISOString();
        const mode = input.mode;
        const orderedRealms = MODE_PLANS[mode] ?? MODE_PLANS.realtime;
        const plan: RealmExecutionPlan = {
            id: randomUUID(), mode, orderedRealms,
            skippedRealms: [],
            parallelGroups: PARALLEL_GROUPS[mode] ?? [],
            timeoutMs: MODE_TIMEOUTS[mode] ?? 100,
            createdAt: ctx.now,
        };
        return {
            pluginName: manifest.name, pluginVersion: manifest.version, status: "success",
            output: plan, confidence: 1.0, evidenceIds: [], warnings: [], errors: [], metrics: met(start),
            provenance: { source: "plugin", method: "mode_plan_lookup", pluginName: manifest.name, pluginVersion: manifest.version, evidenceIds: [], createdAt: ctx.now },
        };
    },
    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
