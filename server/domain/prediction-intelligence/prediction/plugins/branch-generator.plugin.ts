import { randomUUID } from "crypto";
import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { BranchGenerationInput, PredicateCandidate, PredictionBranch } from "../types.js";
import { PREDICTION_EPSILON } from "../types.js";
import { clamp, makePredictionManifest, successResult } from "./plugin-helpers.js";
import { readFileSync } from "fs";
import { join } from "path";

let weights = {
    confidence: 2.0,
    probability: 1.5,
    realmSupport: 1.0,
    hiddenAlignment: 1.0,
    evWeight: 0.5,
    entropy: -1.5,
    bias: -1.0
};

try {
    const weightsPath = join(process.cwd(), "server/domain/prediction-intelligence/prediction/branch_ranker_weights.json");
    const weightsData = readFileSync(weightsPath, "utf-8");
    weights = JSON.parse(weightsData);
} catch (err) {
    console.warn("[BranchGeneratorPlugin] Failed to load weights file, using defaults.");
}

function sigmoid(z: number): number {
    return 1 / (1 + Math.exp(-z));
}

const manifest = makePredictionManifest({
    name: "branch-generator",
    subPod: "branch-generator",
    capability: "prediction.generate_branches",
    description: "Creates branch candidates from predicate candidates and current field dynamics.",
    inputTypes: ["BranchGenerationInput"],
    outputTypes: ["PredictionBranch[]"],
    timeoutMs: 25,
});

function defaultPostPredicate(predicate: PredicateCandidate): string {
    if (predicate.label.includes("request_more_evidence")) return "evidence_gap_review";
    if (predicate.label.includes("anomaly") || predicate.riskClass === "high") return "investigation_required";
    if (predicate.label.includes("resolution")) return "context_stabilization";
    return `${predicate.label}_outcome`;
}

function probabilityWeight(predicate: PredicateCandidate): number {
    const riskReserve = predicate.riskClass === "critical" || predicate.riskClass === "high" ? 0.15 : 0;
    return Math.max(PREDICTION_EPSILON, predicate.confidence + riskReserve);
}

export const branchGeneratorPlugin: PredictionPlugin<BranchGenerationInput, PredictionBranch[]> = {
    manifest,
    async canHandle(input: BranchGenerationInput): Promise<PluginDecision> {
        const ok = !!input?.predictionId && !!input?.context?.id && Array.isArray(input?.predicates);
        return {
            shouldRun: ok,
            reason: ok ? "valid branch generation input" : "missing prediction id, context, or predicates",
            priority: 90,
            estimatedCost: { latencyMs: 4, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },
    async execute(input: BranchGenerationInput, ctx: PluginContext): Promise<PluginResult<PredictionBranch[]>> {
        const startedAt = new Date().toISOString();
        const selected = input.predicates.slice(0, input.modePlan.maxBranches);
        const totalWeight = selected.reduce((sum, p) => sum + probabilityWeight(p), 0) || 1;

        const branches = selected.map(predicate => {
            const probability = probabilityWeight(predicate) / totalWeight;
            const supportingContributions = input.realmContributions.filter(c =>
                predicate.supportingRealmContributionIds.includes(c.id)
                || (c.quantId && predicate.supportingQuantIds.includes(c.quantId))
            );
            const realmSupport = supportingContributions.length > 0
                ? supportingContributions.reduce((sum, c) => sum + c.amount * c.confidence, 0) / supportingContributions.length
                : input.realmContributions.length > 0 ? 0.5 : 0.65;
            const hiddenQuantIds = input.hiddenState?.candidates?.flatMap(c => c.supportingQuantIds) || [];
            const hiddenAlignment = input.hiddenState && predicate.supportingQuantIds.some(id => hiddenQuantIds.includes(id)) ? 0.9 : 0.65;
            const evWeight = clamp(0.5 + predicate.expectedValue / 2, 0.1, 1);
            const entropy = clamp(input.quantField.fieldEntropy * (1 - probability * 0.35));
            
            const features = {
                confidence: predicate.confidence,
                probability: Math.max(0.15, probability),
                realmSupport,
                hiddenAlignment,
                evWeight,
                entropy
            };

            const z = weights.confidence * features.confidence
                    + weights.probability * features.probability
                    + weights.realmSupport * features.realmSupport
                    + weights.hiddenAlignment * features.hiddenAlignment
                    + weights.evWeight * features.evWeight
                    + weights.entropy * features.entropy
                    + weights.bias;
            const branchScore = clamp(sigmoid(z));
            const status = predicate.riskClass === "critical" ? "reserved" : "active";

            const postPredicates = input.postPredicates
                ?.filter(post => post.predicateId === predicate.id)
                .sort((a, b) => b.probability - a.probability)
                .map(post => post.label)
                .slice(0, Math.max(1, input.modePlan.maxDepth)) ?? [defaultPostPredicate(predicate)];

            return {
                id: randomUUID(),
                predictionId: input.predictionId,
                contextId: input.context.id,
                generation: 0,
                predicate: predicate.label,
                postPredicates,
                probability: clamp(probability),
                confidence: clamp(predicate.confidence),
                branchScore,
                entropy,
                expectedValue: predicate.expectedValue,
                status,
                supportingQuantIds: predicate.supportingQuantIds,
                interferingQuantIds: [],
                supportingEventIds: [],
                opposingEventIds: [],
                realmContributions: supportingContributions,
                branchInfluences: [],
                constraints: [],
                payload: { features },
                createdFrom: {
                    eventIds: [],
                    episodeIds: [],
                    quantIds: predicate.supportingQuantIds,
                    hiddenStateIds: input.hiddenState ? [input.hiddenState.id] : [],
                    patternIds: input.memoryMatches?.filter(m => m.label === predicate.label).map(m => m.id) ?? [],
                },
                explanation: `Generated from ${predicate.source} predicate '${predicate.label}'`,
                createdAt: ctx.now,
                updatedAt: ctx.now,
            } satisfies PredictionBranch;
        });

        return successResult(manifest, branches, branches.length > 0 ? 1 : 0, ctx, startedAt, "predicate_to_branch_generation", branches.flatMap(b => b.supportingQuantIds));
    },
    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
