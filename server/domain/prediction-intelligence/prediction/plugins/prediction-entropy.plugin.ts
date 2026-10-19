import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { PredictionEntropyInput, PredictionEntropyResult } from "../types.js";
import { PREDICTION_EPSILON } from "../types.js";
import { clamp, makePredictionManifest, successResult } from "./plugin-helpers.js";

const manifest = makePredictionManifest({
    name: "prediction-entropy",
    subPod: "entropy",
    capability: "prediction.compute_entropy",
    description: "Computes normalized entropy for branch distributions and field conflict.",
    inputTypes: ["PredictionEntropyInput"],
    outputTypes: ["PredictionEntropyResult"],
    timeoutMs: 10,
});

function normalizedEntropy(probabilities: number[]): number {
    if (probabilities.length <= 1) return probabilities.length === 1 ? 0 : 1;
    const total = probabilities.reduce((sum, p) => sum + Math.max(0, p), 0) || 1;
    const h = probabilities.reduce((sum, raw) => {
        const p = Math.max(PREDICTION_EPSILON, raw / total);
        return sum - p * Math.log(p);
    }, 0);
    return clamp(h / Math.log(probabilities.length));
}

export const predictionEntropyPlugin: PredictionPlugin<PredictionEntropyInput, PredictionEntropyResult> = {
    manifest,
    async canHandle(input: PredictionEntropyInput): Promise<PluginDecision> {
        const ok = Array.isArray(input?.branches);
        return {
            shouldRun: ok,
            reason: ok ? "valid entropy input" : "missing branches",
            priority: 80,
            estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },
    async execute(input: PredictionEntropyInput, ctx: PluginContext): Promise<PluginResult<PredictionEntropyResult>> {
        const startedAt = new Date().toISOString();
        const distributionEntropy = normalizedEntropy(input.branches.map(b => b.probability));
        const conflictDelta = Math.min(0.25, (input.realmConflicts?.length ?? 0) * 0.05);
        const predictionEntropy = clamp(distributionEntropy * 0.65 + input.quantField.fieldEntropy * 0.35 + conflictDelta);
        const branchEntropies = input.branches.map(branch => ({
            branchId: branch.id,
            entropy: clamp(branch.entropy * 0.55 + predictionEntropy * 0.45),
        }));

        return successResult(manifest, { predictionEntropy, branchEntropies }, 1, ctx, startedAt, "normalized_branch_entropy");
    },
    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
