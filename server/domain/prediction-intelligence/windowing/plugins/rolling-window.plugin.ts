import { randomUUID } from "crypto";
import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { RollingWindowPluginInput, WindowSummary, DensityMode } from "../types.js";
import { BURST_RATIO_THRESHOLD, SILENCE_RATIO_THRESHOLD, MIN_BURST_DENSITY } from "../types.js";
import { clamp, makeWindowManifest, successResult } from "./plugin-helpers.js";

const manifest = makeWindowManifest({
    name: "rolling-window",
    subPod: "rolling-window",
    capability: "temporal.rolling_window",
    description: "Creates a WindowSummary for a rolling time window given event counts and density (spec §15).",
    inputTypes: ["RollingWindowPluginInput"],
    outputTypes: ["WindowSummary"],
    timeoutMs: 5,
});

function classifyDensityMode(density: number, baseline: number, shortDensity?: number): DensityMode {
    if (baseline <= 0) return density > MIN_BURST_DENSITY ? "high" : "low";
    const ratio = density / baseline;
    if (density < MIN_BURST_DENSITY && baseline > MIN_BURST_DENSITY) return "silent";
    if (shortDensity != null && shortDensity / baseline >= BURST_RATIO_THRESHOLD) return "burst";
    if (ratio >= BURST_RATIO_THRESHOLD) return "burst";
    if (ratio <= 0.1) return "low";
    if (ratio >= 1.5) return "high";
    return "normal";
}

export const rollingWindowPlugin: PredictionPlugin<RollingWindowPluginInput, WindowSummary> = {
    manifest,

    async canHandle(input: RollingWindowPluginInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && input?.durationMs > 0;
        return { shouldRun: ok, reason: ok ? "valid rolling window input" : "missing contextId or duration", priority: 90, estimatedCost: { latencyMs: 0, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: RollingWindowPluginInput, ctx: PluginContext): Promise<PluginResult<WindowSummary>> {
        const startedAt = new Date().toISOString();
        const endMs = Date.parse(input.timestamp);
        const startMs = endMs - input.durationMs;
        const durationSec = input.durationMs / 1000;
        const eventDensity = durationSec > 0 ? input.eventCount / durationSec : 0;
        const baselineDensity = input.baselineDensity ?? 0;
        const densityMode = classifyDensityMode(eventDensity, baselineDensity);
        const burstScore = baselineDensity > 0 ? clamp(eventDensity / baselineDensity / BURST_RATIO_THRESHOLD) : 0;
        const silenceScore = baselineDensity > MIN_BURST_DENSITY && eventDensity < MIN_BURST_DENSITY
            ? clamp(1 - eventDensity / baselineDensity)
            : 0;

        const summary: WindowSummary = {
            id: randomUUID(),
            contextId: input.contextId,
            type: "rolling",
            startTime: new Date(startMs).toISOString(),
            endTime: new Date(endMs).toISOString(),
            durationMs: input.durationMs,
            eventCount: input.eventCount,
            quantCount: input.quantCount,
            eventDensity: clamp(eventDensity, 0, 1000),
            densityMode,
            topActions: input.topActions.slice(0, 5),
            topConcepts: [],
            topThemes: [],
            burstScore: burstScore > 0 ? burstScore : undefined,
            silenceScore: silenceScore > 0 ? silenceScore : undefined,
            createdAt: ctx.now,
        };

        return successResult(manifest, summary, 0.9, ctx, startedAt, "rolling_window");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
