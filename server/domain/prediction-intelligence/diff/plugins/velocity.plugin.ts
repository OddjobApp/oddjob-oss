import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { VelocityPluginInput, DiffRecord } from "../types.js";
import { DIFF_EPSILON } from "../types.js";
import { clamp, makeDiffManifest, successResult } from "./plugin-helpers.js";

const manifest = makeDiffManifest({
    name: "velocity",
    subPod: "velocity",
    capability: "diff.velocity",
    description: "Computes rate of change (velocity) and rate of rate of change (acceleration) for each diff (spec §22-§23).",
    inputTypes: ["VelocityPluginInput"],
    outputTypes: ["DiffRecord[]"],
    timeoutMs: 8,
});

export const velocityPlugin: PredictionPlugin<VelocityPluginInput, DiffRecord[]> = {
    manifest,

    async canHandle(input: VelocityPluginInput): Promise<PluginDecision> {
        const ok = Array.isArray(input?.diffs) && input.deltaMs > 0;
        return {
            shouldRun: ok,
            reason: ok ? "valid velocity input" : "missing diffs or non-positive deltaMs",
            priority: 90,
            estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: VelocityPluginInput, ctx: PluginContext): Promise<PluginResult<DiffRecord[]>> {
        const startedAt = new Date().toISOString();
        const deltaSeconds = Math.max(input.deltaMs / 1000, DIFF_EPSILON);

        const enriched: DiffRecord[] = input.diffs.map(diff => {
            // velocity = magnitude / time
            const velocity = clamp(diff.magnitude / deltaSeconds, 0, 10);

            // acceleration = Δvelocity / Δtime
            let acceleration: number | undefined;
            const prevVelocity = input.previousVelocities?.get(diff.id);
            if (prevVelocity !== undefined) {
                acceleration = clamp((velocity - prevVelocity) / deltaSeconds, 0, 10);
            }

            return { ...diff, velocity, acceleration };
        });

        return successResult(manifest, enriched, 1.0, ctx, startedAt, "velocity_calculation");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
