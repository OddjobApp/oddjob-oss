import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { OutcomeMemoryPluginInput, HistoricalOutcome, MemoryRecallResult } from "../types.js";
import { clamp, makeMemoryManifest, successResult, recencyWeight, applyMemoryScore } from "./plugin-helpers.js";

const manifest = makeMemoryManifest({
    name: "outcome-memory",
    subPod: "outcome-memory",
    capability: "memory.outcome_recall",
    description: "Recalls historical outcomes relevant to target predicates for calibration and branch scoring (spec §16).",
    inputTypes: ["OutcomeMemoryPluginInput"],
    outputTypes: ["MemoryRecallResult<HistoricalOutcome>[]"],
    timeoutMs: 12,
    latencyClass: "interactive",
});

function predicateRelevance(predictedPredicate: string, targetPredicates: string[]): number {
    if (targetPredicates.length === 0) return 0.5;
    const exactMatch = targetPredicates.includes(predictedPredicate);
    if (exactMatch) return 1.0;
    const partialMatch = targetPredicates.some(t =>
        t.toLowerCase().includes(predictedPredicate.toLowerCase()) ||
        predictedPredicate.toLowerCase().includes(t.toLowerCase())
    );
    return partialMatch ? 0.6 : 0.2;
}

export const outcomeMemoryPlugin: PredictionPlugin<OutcomeMemoryPluginInput, MemoryRecallResult<HistoricalOutcome>[]> = {
    manifest,

    async canHandle(input: OutcomeMemoryPluginInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && Array.isArray(input?.outcomes);
        return {
            shouldRun: ok,
            reason: ok ? "valid outcome memory input" : "missing contextId or outcomes",
            priority: 78,
            estimatedCost: { latencyMs: 3, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: OutcomeMemoryPluginInput, ctx: PluginContext): Promise<PluginResult<MemoryRecallResult<HistoricalOutcome>[]>> {
        const startedAt = new Date().toISOString();

        const results: MemoryRecallResult<HistoricalOutcome>[] = input.outcomes.map(outcome => {
            const relevance = predicateRelevance(outcome.predictedPredicate, input.targetPredicates);
            const recency = recencyWeight(outcome.recordedAt, ctx.now);
            // matched outcomes are more reliable evidence
            const outcomeReliability = outcome.matched ? 0.9 : 0.4;

            const score = applyMemoryScore({
                relevance,
                confidence: clamp(outcome.confidenceAtPrediction),
                similarity: relevance,
                recency,
                frequency: 1,
                outcomeReliability,
                contextMatch: outcome.contextId === input.contextId ? 1.0 : 0.5,
                permissionWeight: 1.0,
            });

            return {
                id: outcome.id,
                contextId: input.contextId,
                memoryType: "outcome" as const,
                item: outcome,
                relevance,
                confidence: clamp(outcome.confidenceAtPrediction),
                recency,
                outcomeReliability,
                evidenceIds: outcome.branchId ? [outcome.branchId] : [],
                provenance: {
                    sourceSystem: "memory-pod",
                    sourceId: outcome.predictionId,
                    ingestedAt: ctx.now,
                },
                explanation: `Outcome: predicted '${outcome.predictedPredicate}' → actual '${outcome.actualOutcome}' (${outcome.matched ? "matched" : "missed"}, conf=${outcome.confidenceAtPrediction.toFixed(3)}) — score ${score.toFixed(4)}`,
            };
        });

        results.sort((a, b) => (b.relevance * (b.outcomeReliability ?? 0.5)) - (a.relevance * (a.outcomeReliability ?? 0.5)));

        return successResult(manifest, results, results.length > 0 ? 0.8 : 0, ctx, startedAt, "outcome_recall");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
