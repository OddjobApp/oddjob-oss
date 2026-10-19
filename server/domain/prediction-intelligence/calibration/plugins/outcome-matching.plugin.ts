import { randomUUID } from "crypto";
import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { OutcomeMatchingPluginInput, OutcomeMatch, OutcomeMatchType } from "../types.js";
import { SEMANTIC_SYNONYM_PAIRS, MIN_MATCH_SCORE_FOR_CORRECTNESS } from "../types.js";
import { clamp, makeCalibrationManifest, successResult, keywordOverlap } from "./plugin-helpers.js";

const manifest = makeCalibrationManifest({
    name: "outcome-matching",
    subPod: "outcome-matching",
    capability: "calibration.outcome_matching",
    description: "Matches observed outcomes to prediction branches using exact, semantic, and partial matching (spec §13).",
    inputTypes: ["OutcomeMatchingPluginInput"],
    outputTypes: ["OutcomeMatch[]"],
    timeoutMs: 15,
});

function semanticSynonymScore(outLabel: string, predicate: string): number {
    const a = outLabel.toLowerCase();
    const b = predicate.toLowerCase();
    for (const [termA, termB] of SEMANTIC_SYNONYM_PAIRS) {
        if ((a.includes(termA) && b.includes(termB)) || (a.includes(termB) && b.includes(termA))) return 0.75;
    }
    return 0;
}

function matchBranch(outLabel: string, predicate: string): { type: OutcomeMatchType; score: number } {
    const norm = (s: string) => s.toLowerCase().replace(/[_\s-]+/g, " ");
    const a = norm(outLabel);
    const b = norm(predicate);

    if (a === b) return { type: "exact", score: 1.0 };
    if (a.includes(b) || b.includes(a)) return { type: "exact", score: 0.90 };

    const kwScore = keywordOverlap(a, b);
    if (kwScore >= 0.6) return { type: "semantic", score: kwScore };

    const synScore = semanticSynonymScore(a, b);
    if (synScore > 0) return { type: "causal", score: synScore };

    if (kwScore >= 0.2) return { type: "partial", score: kwScore };

    return { type: "missed", score: 0 };
}

export const outcomeMatchingPlugin: PredictionPlugin<OutcomeMatchingPluginInput, OutcomeMatch[]> = {
    manifest,

    async canHandle(input: OutcomeMatchingPluginInput): Promise<PluginDecision> {
        const ok = !!input?.outcome && Array.isArray(input?.predictions);
        return { shouldRun: ok, reason: ok ? "valid matching input" : "missing outcome or predictions", priority: 95, estimatedCost: { latencyMs: 3, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: OutcomeMatchingPluginInput, ctx: PluginContext): Promise<PluginResult<OutcomeMatch[]>> {
        const startedAt = new Date().toISOString();
        const matches: OutcomeMatch[] = [];

        for (const prediction of input.predictions) {
            // Try to match against each branch
            let bestMatch: OutcomeMatch | null = null;

            for (const branch of prediction.branches) {
                const { type, score } = matchBranch(input.outcome.label, branch.predicate);
                if (score >= MIN_MATCH_SCORE_FOR_CORRECTNESS || type === "exact") {
                    const match: OutcomeMatch = {
                        id: randomUUID(),
                        contextId: input.outcome.contextId,
                        outcomeId: input.outcome.id,
                        predictionId: prediction.id,
                        matchedBranchId: branch.id,
                        matchedPredicate: branch.predicate,
                        matchType: type,
                        matchScore: clamp(score),
                        confidence: clamp(score * input.outcome.sourceTrust),
                        explanation: `Outcome '${input.outcome.label}' matched branch '${branch.predicate}' as ${type} (score=${score.toFixed(3)}, branch_status=${branch.status})`,
                        evidenceIds: input.outcome.relatedEventIds.slice(0, 4),
                        createdAt: ctx.now,
                    };
                    if (!bestMatch || match.matchScore > bestMatch.matchScore) bestMatch = match;
                }
            }

            if (bestMatch) {
                matches.push(bestMatch);
            } else {
                // Emit a "missed" match
                matches.push({
                    id: randomUUID(),
                    contextId: input.outcome.contextId,
                    outcomeId: input.outcome.id,
                    predictionId: prediction.id,
                    matchType: "missed",
                    matchScore: 0,
                    confidence: 0,
                    explanation: `Outcome '${input.outcome.label}' did not match any branch in prediction ${prediction.id}`,
                    evidenceIds: [],
                    createdAt: ctx.now,
                });
            }
        }

        const avgScore = matches.length > 0 ? matches.reduce((s, m) => s + m.matchScore, 0) / matches.length : 0;
        return successResult(manifest, matches, avgScore, ctx, startedAt, "outcome_matching");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
