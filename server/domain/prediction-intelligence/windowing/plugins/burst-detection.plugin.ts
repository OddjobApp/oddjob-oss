import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { BurstDetectionInput, BurstDetectionResult } from "../types.js";
import { BURST_RATIO_THRESHOLD, MIN_BURST_DENSITY } from "../types.js";
import { clamp, makeWindowManifest, successResult } from "./plugin-helpers.js";

const manifest = makeWindowManifest({
    name: "burst-detection",
    subPod: "burst-detection",
    capability: "temporal.burst_detection",
    description: "Detects event bursts by comparing current density against baseline (spec §23).",
    inputTypes: ["BurstDetectionInput"],
    outputTypes: ["BurstDetectionResult"],
    timeoutMs: 5,
});

export const burstDetectionPlugin: PredictionPlugin<BurstDetectionInput, BurstDetectionResult> = {
    manifest,

    async canHandle(input: BurstDetectionInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && !!input?.windowId;
        return { shouldRun: ok, reason: ok ? "valid burst input" : "missing contextId or windowId", priority: 82, estimatedCost: { latencyMs: 0, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: BurstDetectionInput, ctx: PluginContext): Promise<PluginResult<BurstDetectionResult>> {
        const startedAt = new Date().toISOString();
        const { currentDensity, baselineDensity } = input;
        const burstScore = baselineDensity > 0
            ? clamp(currentDensity / baselineDensity / BURST_RATIO_THRESHOLD)
            : currentDensity > MIN_BURST_DENSITY ? clamp(currentDensity / MIN_BURST_DENSITY / BURST_RATIO_THRESHOLD) : 0;

        const burstDetected = baselineDensity > 0
            ? currentDensity / baselineDensity >= BURST_RATIO_THRESHOLD
            : currentDensity > MIN_BURST_DENSITY * BURST_RATIO_THRESHOLD;

        const recommendedAction: BurstDetectionResult["recommendedAction"] =
            burstScore > 0.8 ? "recompute_prediction"
            : burstScore > 0.5 ? "compress_episode"
            : "none";

        return successResult(manifest, {
            contextId: input.contextId,
            windowId: input.windowId,
            burstDetected,
            burstScore,
            eventTypes: input.eventTypes,
            evidenceEventIds: input.evidenceEventIds,
            recommendedAction,
        }, burstScore, ctx, startedAt, "burst_detection", input.evidenceEventIds);
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
