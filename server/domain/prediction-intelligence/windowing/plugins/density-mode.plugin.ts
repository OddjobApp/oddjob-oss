import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { DensityModePluginInput, DensityMode } from "../types.js";
import { BURST_RATIO_THRESHOLD, SILENCE_RATIO_THRESHOLD, MIN_BURST_DENSITY } from "../types.js";
import { clamp, makeWindowManifest, successResult } from "./plugin-helpers.js";

const manifest = makeWindowManifest({
    name: "density-mode",
    subPod: "density-mode",
    capability: "temporal.density_mode",
    description: "Classifies event flow as low/normal/high/burst/silent (spec §22).",
    inputTypes: ["DensityModePluginInput"],
    outputTypes: ["{ densityMode: DensityMode; burstScore?: number; silenceScore?: number }"],
    timeoutMs: 3,
});

interface DensityModeOutput { densityMode: DensityMode; burstScore?: number; silenceScore?: number }

export const densityModePlugin: PredictionPlugin<DensityModePluginInput, DensityModeOutput> = {
    manifest,

    async canHandle(): Promise<PluginDecision> {
        return { shouldRun: true, reason: "density mode always applicable", priority: 88, estimatedCost: { latencyMs: 0, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: DensityModePluginInput, ctx: PluginContext): Promise<PluginResult<DensityModeOutput>> {
        const startedAt = new Date().toISOString();
        const { currentDensity, baselineDensity, shortWindowDensity } = input;
        let densityMode: DensityMode = "normal";
        let burstScore: number | undefined;
        let silenceScore: number | undefined;

        if (baselineDensity <= 0) {
            densityMode = currentDensity > MIN_BURST_DENSITY ? "high" : "low";
        } else {
            const ratio = currentDensity / baselineDensity;
            const shortRatio = shortWindowDensity != null ? shortWindowDensity / baselineDensity : ratio;

            if (currentDensity < MIN_BURST_DENSITY && baselineDensity > MIN_BURST_DENSITY) {
                densityMode = "silent";
                silenceScore = clamp(1 - currentDensity / baselineDensity);
            } else if (shortRatio >= BURST_RATIO_THRESHOLD) {
                densityMode = "burst";
                burstScore = clamp(shortRatio / BURST_RATIO_THRESHOLD);
            } else if (ratio >= 1.5) {
                densityMode = "high";
            } else if (ratio <= 0.3) {
                densityMode = "low";
            }
        }

        return successResult(manifest, { densityMode, burstScore, silenceScore }, 0.95, ctx, startedAt, "density_mode_classification");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
