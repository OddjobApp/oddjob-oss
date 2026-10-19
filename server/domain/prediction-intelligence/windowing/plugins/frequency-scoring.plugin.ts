import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { FrequencyScoringPluginInput } from "../types.js";
import { clamp, makeWindowManifest, successResult, frequencyScore } from "./plugin-helpers.js";

const manifest = makeWindowManifest({
    name: "frequency-scoring",
    subPod: "frequency-scoring",
    capability: "temporal.frequency_score",
    description: "Computes log(1 + count) frequency score for an event type in a window (spec §27).",
    inputTypes: ["FrequencyScoringPluginInput"],
    outputTypes: ["number"],
    timeoutMs: 3,
});

export const frequencyScoringPlugin: PredictionPlugin<FrequencyScoringPluginInput, number> = {
    manifest,

    async canHandle(input: FrequencyScoringPluginInput): Promise<PluginDecision> {
        return { shouldRun: input?.countInWindow >= 0, reason: "valid frequency input", priority: 84, estimatedCost: { latencyMs: 0, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: FrequencyScoringPluginInput, ctx: PluginContext): Promise<PluginResult<number>> {
        const startedAt = new Date().toISOString();
        // If baseline provided, normalize relative to it
        const score = input.baselineCount != null && input.baselineCount > 0
            ? clamp(frequencyScore(input.countInWindow) / frequencyScore(input.baselineCount))
            : frequencyScore(input.countInWindow);
        return successResult(manifest, clamp(score), score, ctx, startedAt, "frequency_scoring");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
