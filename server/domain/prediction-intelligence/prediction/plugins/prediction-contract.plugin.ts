import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { PredictionBranch, PredictionContract, PredictionContractInput } from "../types.js";
import { makePredictionManifest, successResult } from "./plugin-helpers.js";

const manifest = makePredictionManifest({
    name: "prediction-contract",
    subPod: "contract",
    capability: "prediction.assemble_contract",
    description: "Assembles standardized prediction output contract.",
    inputTypes: ["PredictionContractInput"],
    outputTypes: ["PredictionContract"],
    timeoutMs: 10,
});

function branchRank(a: PredictionBranch, b: PredictionBranch): number {
    return b.branchScore - a.branchScore || b.confidence - a.confidence || b.probability - a.probability;
}

export const predictionContractPlugin: PredictionPlugin<PredictionContractInput, PredictionContract> = {
    manifest,
    async canHandle(input: PredictionContractInput): Promise<PluginDecision> {
        const ok = !!input?.prediction?.id;
        return {
            shouldRun: ok,
            reason: ok ? "valid contract input" : "missing prediction",
            priority: 75,
            estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },
    async execute(input: PredictionContractInput, ctx: PluginContext): Promise<PluginResult<PredictionContract>> {
        const startedAt = new Date().toISOString();
        const activeBranches = [...input.activeBranches].sort(branchRank);
        const reservedBranches = [...input.reservedBranches].sort(branchRank);
        const top = activeBranches[0] ?? reservedBranches[0];
        const alternatives = activeBranches.filter(branch => branch.id !== top?.id).slice(0, 5);
        const supportingEvidence = Array.from(new Set(activeBranches.flatMap(branch => branch.supportingEventIds)));
        const opposingEvidence = Array.from(new Set(activeBranches.flatMap(branch => branch.opposingEventIds)));

        const contract: PredictionContract = {
            predictionId: input.prediction.id,
            contextId: input.prediction.contextId,
            createdAt: ctx.now,
            topPrediction: top ? {
                predicate: top.predicate,
                confidence: top.confidence,
                branchScore: top.branchScore,
            } : undefined,
            entropy: input.prediction.entropy,
            collapseDetected: input.prediction.collapseDetected,
            topAlternatives: alternatives,
            quantField: input.quantField,
            hiddenState: input.hiddenState,
            realmAgreement: input.realmAgreement,
            bicameral: input.prediction.bicameral,
            supportingEvidence,
            opposingEvidence,
            activeBranches,
            reservedBranches,
            prunedBranches: input.prunedBranches,
            explanation: input.explanation,
            governance: input.governance,
            provenance: input.prediction.provenance,
        };

        return successResult(manifest, contract, top?.confidence ?? 0, ctx, startedAt, "prediction_contract_assembly", supportingEvidence);
    },
    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
