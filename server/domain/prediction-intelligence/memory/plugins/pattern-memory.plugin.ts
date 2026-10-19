import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { PatternMemoryPluginInput, PatternMemory, MemoryRecallResult } from "../types.js";
import {
    clamp, makeMemoryManifest, successResult,
    recencyWeight, frequencyWeight, outcomeReliabilityWeight, applyMemoryScore,
} from "./plugin-helpers.js";

const manifest = makeMemoryManifest({
    name: "pattern-memory",
    subPod: "pattern-memory",
    capability: "memory.pattern_recall",
    description: "Recalls known patterns relevant to current predicates and optionally Qdrant vector results (spec §13).",
    inputTypes: ["PatternMemoryPluginInput"],
    outputTypes: ["MemoryRecallResult<PatternMemory>[]"],
    timeoutMs: 15,
    latencyClass: "interactive",
});

function computePredicateOverlap(patternPredicates: string[], activePredicates: string[]): number {
    if (patternPredicates.length === 0 || activePredicates.length === 0) return 0.3;
    const matching = patternPredicates.filter(p =>
        activePredicates.some(ap => ap.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(ap.toLowerCase()))
    ).length;
    return clamp(matching / Math.max(patternPredicates.length, activePredicates.length));
}

function computeOutcomeReliability(pattern: PatternMemory): number {
    if (pattern.historicalOutcomes.length === 0) return 0.6;
    const avgMatchRate = pattern.historicalOutcomes.reduce((s, o) => s + o.matchRate, 0) / pattern.historicalOutcomes.length;
    return outcomeReliabilityWeight(avgMatchRate);
}

export const patternMemoryPlugin: PredictionPlugin<PatternMemoryPluginInput, MemoryRecallResult<PatternMemory>[]> = {
    manifest,

    async canHandle(input: PatternMemoryPluginInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && Array.isArray(input?.patterns);
        return {
            shouldRun: ok,
            reason: ok ? "valid pattern memory input" : "missing contextId or patterns",
            priority: 85,
            estimatedCost: { latencyMs: 4, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: PatternMemoryPluginInput, ctx: PluginContext): Promise<PluginResult<MemoryRecallResult<PatternMemory>[]>> {
        const startedAt = new Date().toISOString();
        const vectorScoreMap = new Map(input.vectorResults.map(r => [r.id, r.score]));

        const results: MemoryRecallResult<PatternMemory>[] = input.patterns.map(pattern => {
            const predicateOverlap = computePredicateOverlap(pattern.typicalPredicates, input.activePredicates);
            const vectorScore = vectorScoreMap.get(pattern.embeddingId ?? pattern.id) ?? vectorScoreMap.get(pattern.id);
            const similarity = vectorScore != null ? clamp(vectorScore) : predicateOverlap;
            const recency = recencyWeight(pattern.updatedAt, ctx.now);
            const frequency = frequencyWeight(pattern.supportCount);
            const outcomeReliability = computeOutcomeReliability(pattern);

            const score = applyMemoryScore({
                relevance: predicateOverlap,
                confidence: clamp(pattern.confidence),
                similarity,
                recency,
                frequency,
                outcomeReliability,
                contextMatch: 0.6,
                permissionWeight: 1.0,
            });

            const topOutcome = pattern.historicalOutcomes
                .sort((a, b) => b.matchRate - a.matchRate)[0];

            return {
                id: pattern.id,
                contextId: input.contextId,
                memoryType: "pattern" as const,
                item: pattern,
                relevance: predicateOverlap,
                confidence: clamp(pattern.confidence),
                similarity,
                recency,
                frequency,
                outcomeReliability,
                evidenceIds: [],
                provenance: {
                    sourceSystem: "memory-pod",
                    sourceId: pattern.id,
                    ingestedAt: ctx.now,
                },
                explanation: `Pattern '${pattern.name}' (${pattern.patternType}) matches ${Math.round(predicateOverlap * 100)}% of active predicates${topOutcome ? `; typical outcome: '${topOutcome.actualOutcome}' at ${Math.round(topOutcome.matchRate * 100)}%` : ""}. Score: ${score.toFixed(4)}`,
            };
        });

        // Sort by score descending
        results.sort((a, b) => {
            const sa = applyMemoryScore({ relevance: a.relevance, confidence: a.confidence, similarity: a.similarity ?? a.relevance, recency: a.recency ?? 1, frequency: a.frequency ?? 1, outcomeReliability: a.outcomeReliability ?? 0.7, contextMatch: 0.6, permissionWeight: 1 });
            const sb = applyMemoryScore({ relevance: b.relevance, confidence: b.confidence, similarity: b.similarity ?? b.relevance, recency: b.recency ?? 1, frequency: b.frequency ?? 1, outcomeReliability: b.outcomeReliability ?? 0.7, contextMatch: 0.6, permissionWeight: 1 });
            return sb - sa;
        });

        const avgConfidence = results.length > 0 ? results.reduce((s, r) => s + r.confidence, 0) / results.length : 0;
        return successResult(manifest, results, avgConfidence, ctx, startedAt, "pattern_recall");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
