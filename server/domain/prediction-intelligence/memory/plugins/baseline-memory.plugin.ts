import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { BaselineMemoryPluginInput, BaselineMemory, MemoryRecallResult } from "../types.js";
import { clamp, makeMemoryManifest, successResult, recencyWeight, frequencyWeight, applyMemoryScore } from "./plugin-helpers.js";

const manifest = makeMemoryManifest({
    name: "baseline-memory",
    subPod: "baseline-memory",
    capability: "memory.baseline_recall",
    description: "Recalls expected-behavior baselines for a context (spec §17).",
    inputTypes: ["BaselineMemoryPluginInput"],
    outputTypes: ["MemoryRecallResult<BaselineMemory>[]"],
    timeoutMs: 10,
});

export const baselineMemoryPlugin: PredictionPlugin<BaselineMemoryPluginInput, MemoryRecallResult<BaselineMemory>[]> = {
    manifest,

    async canHandle(input: BaselineMemoryPluginInput): Promise<PluginDecision> {
        const ok = !!input?.contextId && Array.isArray(input?.baselines);
        return {
            shouldRun: ok,
            reason: ok ? "valid baseline memory input" : "missing contextId or baselines",
            priority: 80,
            estimatedCost: { latencyMs: 2, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: BaselineMemoryPluginInput, ctx: PluginContext): Promise<PluginResult<MemoryRecallResult<BaselineMemory>[]>> {
        const startedAt = new Date().toISOString();

        const results: MemoryRecallResult<BaselineMemory>[] = input.baselines.map(baseline => {
            // Relevance: type requested boost + exact context match
            const typeRequested = input.requestedTypes.length === 0 || input.requestedTypes.includes(baseline.baselineType);
            const contextBoost = baseline.contextId === input.contextId ? 1.0 : 0.5;
            const relevance = clamp((typeRequested ? 0.8 : 0.4) * contextBoost);

            const recency = recencyWeight(baseline.updatedAt, ctx.now);
            const frequency = frequencyWeight(baseline.sampleSize);

            const score = applyMemoryScore({
                relevance,
                confidence: clamp(baseline.confidence),
                similarity: 1.0,
                recency,
                frequency,
                outcomeReliability: 0.8,
                contextMatch: contextBoost,
                permissionWeight: 1.0,
            });

            return {
                id: baseline.id,
                contextId: input.contextId,
                memoryType: "baseline" as const,
                item: baseline,
                relevance,
                confidence: clamp(baseline.confidence),
                recency,
                frequency,
                outcomeReliability: 0.8,
                evidenceIds: [],
                provenance: {
                    sourceSystem: "memory-pod",
                    sourceId: baseline.id,
                    ingestedAt: ctx.now,
                },
                explanation: `Baseline '${baseline.baselineType}' (scope=${baseline.scope}, n=${baseline.sampleSize}) — score ${score.toFixed(4)}`,
            };
        });

        results.sort((a, b) => {
            const sa = applyMemoryScore({ relevance: a.relevance, confidence: a.confidence, similarity: 1, recency: a.recency ?? 1, frequency: a.frequency ?? 1, outcomeReliability: 0.8, contextMatch: a.relevance, permissionWeight: 1 });
            const sb = applyMemoryScore({ relevance: b.relevance, confidence: b.confidence, similarity: 1, recency: b.recency ?? 1, frequency: b.frequency ?? 1, outcomeReliability: 0.8, contextMatch: b.relevance, permissionWeight: 1 });
            return sb - sa;
        });

        return successResult(manifest, results, results.length > 0 ? 0.85 : 0, ctx, startedAt, "baseline_recall");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
