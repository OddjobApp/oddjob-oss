import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { MemoryRecallScorerInput, MemoryRecallResult } from "../types.js";
import { clamp, makeMemoryManifest, successResult, applyMemoryScore } from "./plugin-helpers.js";

const manifest = makeMemoryManifest({
    name: "memory-recall-scorer",
    subPod: "memory-recall-scorer",
    capability: "memory.recall_scoring",
    description: "Scores, de-duplicates, and ranks all memory recall candidates using the full scoring formula (spec §21).",
    inputTypes: ["MemoryRecallScorerInput"],
    outputTypes: ["MemoryRecallResult[]"],
    timeoutMs: 10,
});

function scoreCandidate(r: MemoryRecallResult): number {
    return applyMemoryScore({
        relevance: clamp(r.relevance),
        confidence: clamp(r.confidence),
        similarity: clamp(r.similarity ?? r.relevance),
        recency: clamp(r.recency ?? 0.8),
        frequency: clamp(r.frequency ?? 0.5),
        outcomeReliability: clamp(r.outcomeReliability ?? 0.7),
        contextMatch: 0.6,
        permissionWeight: 1.0,
    });
}

export const memoryRecallScorerPlugin: PredictionPlugin<MemoryRecallScorerInput, MemoryRecallResult[]> = {
    manifest,

    async canHandle(input: MemoryRecallScorerInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && Array.isArray(input?.candidates);
        return {
            shouldRun: ok,
            reason: ok ? "valid scorer input" : "missing contextId or candidates",
            priority: 70,
            estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: MemoryRecallScorerInput, ctx: PluginContext): Promise<PluginResult<MemoryRecallResult[]>> {
        const startedAt = new Date().toISOString();

        // Score all candidates
        const scored = input.candidates.map(r => ({ r, score: scoreCandidate(r) }));

        // Sort descending by score
        scored.sort((a, b) => b.score - a.score);

        // Apply limit
        const top = scored.slice(0, input.limit).map(({ r }) => r);

        const avgScore = scored.length > 0
            ? scored.slice(0, input.limit).reduce((s, { score }) => s + score, 0) / Math.min(scored.length, input.limit)
            : 0;

        return successResult(manifest, top, clamp(avgScore), ctx, startedAt, "memory_recall_scoring");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
