import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { HiddenStateEntropyPluginInput, HiddenStateEntropyResult } from "../types.js";
import { clamp, makeHiddenStateManifest, successResult, shannonEntropy } from "./plugin-helpers.js";

const manifest = makeHiddenStateManifest({
    name: "hidden-state-entropy",
    subPod: "hidden-state-entropy",
    capability: "hidden_state.entropy",
    description: "Computes Shannon entropy of the hidden-state probability distribution (spec §18).",
    inputTypes: ["HiddenStateEntropyPluginInput"],
    outputTypes: ["HiddenStateEntropyResult"],
    timeoutMs: 5,
});

export const hiddenStateEntropyPlugin: PredictionPlugin<HiddenStateEntropyPluginInput, HiddenStateEntropyResult> = {
    manifest,

    async canHandle(input: HiddenStateEntropyPluginInput): Promise<PluginDecision> {
        const ok = Array.isArray(input?.candidates);
        return {
            shouldRun: ok,
            reason: ok ? "valid entropy input" : "missing candidates",
            priority: 88,
            estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: HiddenStateEntropyPluginInput, ctx: PluginContext): Promise<PluginResult<HiddenStateEntropyResult>> {
        const startedAt = new Date().toISOString();

        const probs = input.candidates.map(c => c.probability);
        const globalEntropy = shannonEntropy(probs);

        // Per-candidate contribution to entropy
        const total = probs.reduce((s, p) => s + p, 0) || 1;
        const candidateEntropies = input.candidates.map(c => {
            const pn = c.probability / total;
            const contribution = pn > 0 ? -pn * Math.log(pn) : 0;
            return { candidateId: c.id, entropy: clamp(contribution) };
        });

        return successResult(
            manifest,
            { globalEntropy, candidateEntropies },
            clamp(1 - globalEntropy / Math.max(Math.log(input.candidates.length || 1), 1)),
            ctx, startedAt, "entropy_calculation",
        );
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
