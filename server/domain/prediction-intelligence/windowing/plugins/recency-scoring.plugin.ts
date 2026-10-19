import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { RecencyScoringPluginInput } from "../types.js";
import { DEFAULT_RECENCY_LAMBDA } from "../types.js";
import { clamp, makeWindowManifest, successResult, recencyDecay } from "./plugin-helpers.js";

const manifest = makeWindowManifest({
    name: "recency-scoring",
    subPod: "recency-scoring",
    capability: "temporal.recency_score",
    description: "Computes exp(-λ Δt) recency score for an event (spec §26).",
    inputTypes: ["RecencyScoringPluginInput"],
    outputTypes: ["number"],
    timeoutMs: 3,
});

export const recencyScoringPlugin: PredictionPlugin<RecencyScoringPluginInput, number> = {
    manifest,

    async canHandle(input: RecencyScoringPluginInput): Promise<PluginDecision> {
        return { shouldRun: !!input?.occurredAt, reason: !!input?.occurredAt ? "valid recency input" : "missing occurredAt", priority: 85, estimatedCost: { latencyMs: 0, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: RecencyScoringPluginInput, ctx: PluginContext): Promise<PluginResult<number>> {
        const startedAt = new Date().toISOString();
        const lambda = input.decayLambda ?? DEFAULT_RECENCY_LAMBDA;
        const score = recencyDecay(input.occurredAt, input.now ?? ctx.now, lambda);
        return successResult(manifest, clamp(score), score, ctx, startedAt, "recency_scoring");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
