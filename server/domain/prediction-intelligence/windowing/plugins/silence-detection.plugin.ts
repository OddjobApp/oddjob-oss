import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { SilenceDetectionInput, SilenceDetectionResult } from "../types.js";
import { SILENCE_RATIO_THRESHOLD } from "../types.js";
import { clamp, makeWindowManifest, successResult } from "./plugin-helpers.js";

const manifest = makeWindowManifest({
    name: "silence-detection",
    subPod: "silence-detection",
    capability: "temporal.silence_detection",
    description: "Detects meaningful event absence by comparing actual gap to expected gap (spec §24).",
    inputTypes: ["SilenceDetectionInput"],
    outputTypes: ["SilenceDetectionResult"],
    timeoutMs: 5,
});

export const silenceDetectionPlugin: PredictionPlugin<SilenceDetectionInput, SilenceDetectionResult> = {
    manifest,

    async canHandle(input: SilenceDetectionInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && input?.expectedGapMs > 0;
        return { shouldRun: ok, reason: ok ? "valid silence input" : "missing contextId or expectedGapMs", priority: 80, estimatedCost: { latencyMs: 0, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: SilenceDetectionInput, ctx: PluginContext): Promise<PluginResult<SilenceDetectionResult>> {
        const startedAt = new Date().toISOString();
        const ratio = input.actualGapMs / input.expectedGapMs;
        const silenceScore = clamp(Math.min(ratio / SILENCE_RATIO_THRESHOLD, 3) / 3);
        const silenceDetected = ratio >= SILENCE_RATIO_THRESHOLD;
        // Only suggest creating an absence event when significantly overdue (3× expected gap)
        const createAbsenceEvent = ratio >= 3;

        return successResult(manifest, {
            contextId: input.contextId,
            expectedEventType: input.expectedEventType,
            silenceDetected,
            silenceScore,
            expectedGapMs: input.expectedGapMs,
            actualGapMs: input.actualGapMs,
            createAbsenceEvent,
            evidenceEventIds: input.lastEventId ? [input.lastEventId, ...(input.evidenceEventIds ?? [])] : (input.evidenceEventIds ?? []),
        }, silenceScore, ctx, startedAt, "silence_detection");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
