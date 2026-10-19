import { randomUUID } from "crypto";
import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { ForwardChamberInput, ForwardChamberResult } from "../types.js";
import { clamp, makePredictionManifest, successResult } from "./plugin-helpers.js";

const manifest = makePredictionManifest({
    name: "forward-chamber",
    subPod: "forward-chamber",
    capability: "prediction.forward_score",
    description: "Scores branches from prior/current quant field trajectory.",
    inputTypes: ["ForwardChamberInput"],
    outputTypes: ["ForwardChamberResult"],
    timeoutMs: 25,
});

export const forwardChamberPlugin: PredictionPlugin<ForwardChamberInput, ForwardChamberResult> = {
    manifest,
    async canHandle(input: ForwardChamberInput): Promise<PluginDecision> {
        const ok = !!input?.context?.id && Array.isArray(input?.branches);
        return {
            shouldRun: ok,
            reason: ok ? "valid forward chamber input" : "missing context or branches",
            priority: 85,
            estimatedCost: { latencyMs: 3, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },
    async execute(input: ForwardChamberInput, ctx: PluginContext): Promise<PluginResult<ForwardChamberResult>> {
        const startedAt = new Date().toISOString();
        const fieldCoherence = clamp(input.quantField.fieldCoherence);
        const fieldAlignment = clamp(input.quantField.fieldAlignment);

        const branchScores = input.branches.map(branch => {
            const supportQuants = input.activeQuants.filter(q => branch.supportingQuantIds.includes(q.id));
            const quantSupport = supportQuants.length > 0
                ? supportQuants.reduce((sum, q) => sum + q.magnitude * q.confidence, 0) / supportQuants.length
                : 0.45;
            const realmSupport = branch.realmContributions.length > 0
                ? branch.realmContributions.reduce((sum, c) => sum + c.amount * c.confidence, 0) / branch.realmContributions.length
                : 0.55;
            const hiddenStateBoost = input.hiddenState && branch.createdFrom.hiddenStateIds.includes(input.hiddenState.id) ? 0.12 : 0;
            const patternBoost = input.memoryMatches?.some(match => branch.createdFrom.patternIds.includes(match.id)) ? 0.08 : 0;
            const score = clamp(
                branch.probability * 0.35
                + quantSupport * 0.25
                + fieldCoherence * 0.15
                + fieldAlignment * 0.1
                + realmSupport * 0.1
                + hiddenStateBoost
                + patternBoost
            );

            return {
                branchId: branch.id,
                score,
                confidence: clamp((branch.confidence + quantSupport + fieldCoherence) / 3),
                explanation: `forward score combines probability=${branch.probability.toFixed(3)}, quant support=${quantSupport.toFixed(3)}, field coherence=${fieldCoherence.toFixed(3)}`,
            };
        });

        const dominantBranchId = branchScores.sort((a, b) => b.score - a.score)[0]?.branchId;
        const result: ForwardChamberResult = {
            id: randomUUID(),
            contextId: input.context.id,
            branchScores,
            dominantBranchId,
            entropy: input.quantField.fieldEntropy,
            createdAt: ctx.now,
        };

        return successResult(manifest, result, branchScores.length > 0 ? 1 : 0, ctx, startedAt, "forward_branch_scoring");
    },
    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
