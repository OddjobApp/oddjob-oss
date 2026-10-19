import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { AttractorMemoryPluginInput, AttractorMemory, MemoryRecallResult } from "../types.js";
import { clamp, makeMemoryManifest, successResult, recencyWeight, applyMemoryScore } from "./plugin-helpers.js";

const manifest = makeMemoryManifest({
    name: "attractor-memory",
    subPod: "attractor-memory",
    capability: "memory.attractor_recall",
    description: "Recalls nearest attractors by predicate/hidden-state matching and optional Qdrant vector results (spec §15).",
    inputTypes: ["AttractorMemoryPluginInput"],
    outputTypes: ["MemoryRecallResult<AttractorMemory>[]"],
    timeoutMs: 12,
    latencyClass: "interactive",
});

function computeAttractorRelevance(
    attractor: AttractorMemory,
    queryPredicates: string[],
    queryHiddenStates: string[],
): number {
    let score = 0;
    let weight = 0;

    if (queryPredicates.length > 0) {
        const predicateOverlap = attractor.associatedPredicates.filter(p =>
            queryPredicates.some(qp => qp.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(qp.toLowerCase()))
        ).length / Math.max(attractor.associatedPredicates.length, 1);
        score += predicateOverlap * 0.6;
        weight += 0.6;
    }

    if (queryHiddenStates.length > 0) {
        const hsOverlap = attractor.associatedHiddenStates.filter(h =>
            queryHiddenStates.some(qh => qh.toLowerCase().includes(h.toLowerCase()) || h.toLowerCase().includes(qh.toLowerCase()))
        ).length / Math.max(attractor.associatedHiddenStates.length, 1);
        score += hsOverlap * 0.4;
        weight += 0.4;
    }

    return weight > 0 ? clamp(score / weight) : 0.3;
}

export const attractorMemoryPlugin: PredictionPlugin<AttractorMemoryPluginInput, MemoryRecallResult<AttractorMemory>[]> = {
    manifest,

    async canHandle(input: AttractorMemoryPluginInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && Array.isArray(input?.attractors);
        return {
            shouldRun: ok,
            reason: ok ? "valid attractor memory input" : "missing contextId or attractors",
            priority: 82,
            estimatedCost: { latencyMs: 3, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: AttractorMemoryPluginInput, ctx: PluginContext): Promise<PluginResult<MemoryRecallResult<AttractorMemory>[]>> {
        const startedAt = new Date().toISOString();
        const vectorScoreMap = new Map(input.vectorResults.map(r => [r.id, r.score]));

        const results: MemoryRecallResult<AttractorMemory>[] = input.attractors.map(attractor => {
            const relevance = computeAttractorRelevance(attractor, input.queryPredicates, input.queryHiddenStates);
            const vectorScore = vectorScoreMap.get(attractor.embeddingId ?? attractor.id) ?? vectorScoreMap.get(attractor.id);
            const similarity = vectorScore != null ? clamp(vectorScore) : relevance;
            const recency = recencyWeight(attractor.updatedAt, ctx.now);

            const score = applyMemoryScore({
                relevance,
                confidence: clamp(attractor.confidence),
                similarity,
                recency,
                frequency: clamp(attractor.pullStrength),
                outcomeReliability: 0.75,
                contextMatch: 0.6,
                permissionWeight: 1.0,
            });

            return {
                id: attractor.id,
                contextId: input.contextId,
                memoryType: "attractor" as const,
                item: attractor,
                relevance,
                confidence: clamp(attractor.confidence),
                similarity,
                recency,
                frequency: clamp(attractor.pullStrength),
                outcomeReliability: 0.75,
                evidenceIds: [],
                provenance: {
                    sourceSystem: "memory-pod",
                    sourceId: attractor.id,
                    ingestedAt: ctx.now,
                },
                explanation: `Attractor '${attractor.name}' (${attractor.type}, pull=${attractor.pullStrength.toFixed(3)}) relevance ${relevance.toFixed(3)} — score ${score.toFixed(4)}`,
            };
        });

        results.sort((a, b) => {
            const sa = applyMemoryScore({ relevance: a.relevance, confidence: a.confidence, similarity: a.similarity ?? a.relevance, recency: a.recency ?? 1, frequency: a.frequency ?? 1, outcomeReliability: 0.75, contextMatch: 0.6, permissionWeight: 1 });
            const sb = applyMemoryScore({ relevance: b.relevance, confidence: b.confidence, similarity: b.similarity ?? b.relevance, recency: b.recency ?? 1, frequency: b.frequency ?? 1, outcomeReliability: 0.75, contextMatch: 0.6, permissionWeight: 1 });
            return sb - sa;
        });

        return successResult(manifest, results, results.length > 0 ? 0.8 : 0, ctx, startedAt, "attractor_recall");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
