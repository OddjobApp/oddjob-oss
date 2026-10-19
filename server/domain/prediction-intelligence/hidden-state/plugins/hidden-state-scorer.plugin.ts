import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { HiddenStateScoringPluginInput, HiddenStateCandidate } from "../types.js";
import { HS_EPSILON } from "../types.js";
import { clamp, makeHiddenStateManifest, successResult, normaliseProbabilities } from "./plugin-helpers.js";

const manifest = makeHiddenStateManifest({
    name: "hidden-state-scorer",
    subPod: "hidden-state-scorer",
    capability: "hidden_state.score_candidates",
    description: "Refines hidden-state candidate scores using quant support, realm agreement, and persistence prior (spec §12).",
    inputTypes: ["HiddenStateScoringPluginInput"],
    outputTypes: ["HiddenStateCandidate[]"],
    timeoutMs: 12,
});

function computeQuantSupport(candidate: HiddenStateCandidate, input: HiddenStateScoringPluginInput): number {
    if (candidate.supportingQuantIds.length === 0) return 0.4;
    const supportingQuants = input.activeQuants.filter(q => candidate.supportingQuantIds.includes(q.id));
    if (supportingQuants.length === 0) return 0.3;
    const activeSupport = supportingQuants.filter(q => q.lifecycle.status === "active" || q.lifecycle.status === "decaying");
    return clamp(activeSupport.reduce((s, q) => s + q.magnitude * q.confidence, 0) / supportingQuants.length);
}

function computeRealmAgreement(candidate: HiddenStateCandidate, input: HiddenStateScoringPluginInput): number {
    const relevant = input.realmContributions.filter(c =>
        candidate.realmContributionIds.includes(c.id) ||
        (c.quantId && candidate.supportingQuantIds.includes(c.quantId))
    );
    if (relevant.length === 0) return 0.5;
    const boosts = relevant.filter(c => c.effect === "boost" || c.effect === "preserve").length;
    const suppresses = relevant.filter(c => c.effect === "suppress" || c.effect === "constrain").length;
    return clamp((boosts - suppresses) / relevant.length * 0.5 + 0.5);
}

function computePersistencePrior(candidate: HiddenStateCandidate, input: HiddenStateScoringPluginInput): number {
    if (!input.previousEstimate) return 0.2;
    const prev = input.previousEstimate.candidates.find(c => c.label === candidate.label);
    if (!prev) return 0.15;
    return clamp(0.3 + prev.probability * 0.5 + prev.persistence * 0.2);
}

export const hiddenStateScorerPlugin: PredictionPlugin<HiddenStateScoringPluginInput, HiddenStateCandidate[]> = {
    manifest,

    async canHandle(input: HiddenStateScoringPluginInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && Array.isArray(input?.candidates);
        return {
            shouldRun: ok,
            reason: ok ? "valid scoring input" : "missing contextId or candidates",
            priority: 95,
            estimatedCost: { latencyMs: 3, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: HiddenStateScoringPluginInput, ctx: PluginContext): Promise<PluginResult<HiddenStateCandidate[]>> {
        const startedAt = new Date().toISOString();

        // Compute raw scores per candidate
        const rawScores = input.candidates.map(c => {
            const quantSupport = computeQuantSupport(c, input);
            const realmAgreement = computeRealmAgreement(c, input);
            const persistencePrior = computePersistencePrior(c, input);
            const fieldEntropy = Math.max(input.quantField.fieldEntropy, HS_EPSILON);

            const score = quantSupport * realmAgreement * persistencePrior / fieldEntropy;
            return { candidate: c, score, quantSupport, realmAgreement, persistencePrior };
        });

        // Normalise scores to probabilities
        const probs = normaliseProbabilities(rawScores.map(r => r.score));

        const scored: HiddenStateCandidate[] = rawScores.map((r, i) => ({
            ...r.candidate,
            probability: clamp(probs[i]),
            confidence: clamp((r.quantSupport + r.realmAgreement) / 2),
            activation: clamp(r.score / Math.max(...rawScores.map(x => x.score), HS_EPSILON)),
            explanation:
                `qs=${r.quantSupport.toFixed(3)} ra=${r.realmAgreement.toFixed(3)} pp=${r.persistencePrior.toFixed(3)} → score=${r.score.toFixed(4)}`,
            updatedAt: ctx.now,
        }));

        scored.sort((a, b) => b.probability - a.probability);

        return successResult(manifest, scored, scored[0]?.confidence ?? 0, ctx, startedAt, "candidate_scoring");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
