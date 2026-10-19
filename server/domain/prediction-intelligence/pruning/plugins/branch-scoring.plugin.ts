import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { BranchScoringInput, BranchScoreBreakdown } from "../types.js";
import { CONSEQUENCE_LABELS, PRUNING_EPSILON } from "../types.js";
import { clamp, makePruningManifest, successResult, hasHighConsequence } from "./plugin-helpers.js";

const manifest = makePruningManifest({
    name: "branch-scoring",
    subPod: "branch-scoring",
    capability: "pruning.score_branches",
    description: "Refines branch scores before pruning using the full scoring formula (spec §8).",
    inputTypes: ["BranchScoringInput"],
    outputTypes: ["BranchScoreBreakdown[]"],
    timeoutMs: 15,
});

function computeQuantSupport(branchId: string, supportingQuantIds: string[], input: BranchScoringInput): number {
    const quants = input.activeQuants.filter(q => supportingQuantIds.includes(q.id));
    if (quants.length === 0) return 0.5;
    return clamp(quants.reduce((sum, q) => sum + q.magnitude * q.confidence, 0) / quants.length);
}

function computeRealmAgreement(branchId: string, input: BranchScoringInput): number {
    const contribs = input.realmContributions.filter(c =>
        c.branchId === branchId || c.targetId === branchId
    );
    if (contribs.length === 0) return 0.6;
    const boosts = contribs.filter(c => c.effect === "boost" || c.effect === "preserve").length;
    const suppresses = contribs.filter(c => c.effect === "suppress" || c.effect === "constrain").length;
    return clamp((boosts - suppresses) / contribs.length * 0.5 + 0.5);
}

function computeHiddenStateAlignment(supportingQuantIds: string[], input: BranchScoringInput): number {
    if (!input.hiddenState) return 0.65;
    const hiddenQuantIds = input.hiddenState.candidates.flatMap(candidate => candidate.supportingQuantIds);
    const overlap = supportingQuantIds.some(id => hiddenQuantIds.includes(id));
    return overlap ? 0.9 : 0.55;
}

function computeConsequenceWeight(postPredicates: string[]): number {
    return hasHighConsequence(postPredicates, CONSEQUENCE_LABELS) ? 1.15 : 1.0;
}

export const branchScoringPlugin: PredictionPlugin<BranchScoringInput, BranchScoreBreakdown[]> = {
    manifest,

    async canHandle(input: BranchScoringInput): Promise<PluginDecision> {
        const ok = !!input?.predictionId && !!input?.contextId && Array.isArray(input?.branches);
        return {
            shouldRun: ok,
            reason: ok ? "valid branch scoring input" : "missing predictionId, contextId, or branches",
            priority: 100,
            estimatedCost: { latencyMs: 2, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: BranchScoringInput, ctx: PluginContext): Promise<PluginResult<BranchScoreBreakdown[]>> {
        const startedAt = new Date().toISOString();

        const breakdowns: BranchScoreBreakdown[] = input.branches.map(branch => {
            const probability = clamp(branch.probability);
            const confidence = clamp(branch.confidence);
            const quantSupport = computeQuantSupport(branch.id, branch.supportingQuantIds, input);
            const realmAgreement = computeRealmAgreement(branch.id, input);
            const hiddenStateAlignment = computeHiddenStateAlignment(branch.supportingQuantIds, input);
            const bicameralAgreement = clamp(branch.bicameralAgreement ?? 0.7);
            // Normalise expectedValue from [-1,1] to [0.1, 1]
            const expectedValue = clamp(0.5 + branch.expectedValue * 0.5, 0.1, 1);
            const consequenceWeight = computeConsequenceWeight(branch.postPredicates);
            const entropyPenalty = clamp(branch.entropy, PRUNING_EPSILON, 1);

            const rawScore =
                probability
                * confidence
                * quantSupport
                * realmAgreement
                * hiddenStateAlignment
                * bicameralAgreement
                * expectedValue
                * consequenceWeight
                / Math.max(entropyPenalty, PRUNING_EPSILON);

            const finalScore = clamp(rawScore);

            const explanation = [
                `p=${probability.toFixed(3)}`,
                `conf=${confidence.toFixed(3)}`,
                `qs=${quantSupport.toFixed(3)}`,
                `ra=${realmAgreement.toFixed(3)}`,
                `hsa=${hiddenStateAlignment.toFixed(3)}`,
                `bic=${bicameralAgreement.toFixed(3)}`,
                `ev=${expectedValue.toFixed(3)}`,
                `cw=${consequenceWeight.toFixed(3)}`,
                `ent=${entropyPenalty.toFixed(3)}`,
                `→score=${finalScore.toFixed(4)}`,
            ].join(" ");

            return {
                branchId: branch.id,
                probability,
                confidence,
                quantSupport,
                realmAgreement,
                hiddenStateAlignment,
                bicameralAgreement,
                expectedValue,
                consequenceWeight,
                entropyPenalty,
                finalScore,
                explanation,
            };
        });

        const avgScore = breakdowns.length > 0
            ? breakdowns.reduce((s, b) => s + b.finalScore, 0) / breakdowns.length
            : 0;

        return successResult(
            manifest,
            breakdowns,
            clamp(avgScore),
            ctx,
            startedAt,
            "branch_score_refinement",
            input.branches.flatMap(b => b.supportingQuantIds),
        );
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
