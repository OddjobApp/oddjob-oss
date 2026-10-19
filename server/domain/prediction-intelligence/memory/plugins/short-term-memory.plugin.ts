import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { ShortTermMemoryPluginInput, MemoryRecallResult } from "../types.js";
import { clamp, makeMemoryManifest, successResult, recencyWeight, contextMatchWeight } from "./plugin-helpers.js";

const manifest = makeMemoryManifest({
    name: "short-term-memory",
    subPod: "short-term-memory",
    capability: "memory.short_term_recall",
    description: "Returns hot active memory for the current context: recent quants and active branches (spec §11).",
    inputTypes: ["ShortTermMemoryPluginInput"],
    outputTypes: ["MemoryRecallResult[]"],
    timeoutMs: 8,
});

export const shortTermMemoryPlugin: PredictionPlugin<ShortTermMemoryPluginInput, MemoryRecallResult[]> = {
    manifest,

    async canHandle(input: ShortTermMemoryPluginInput): Promise<PluginDecision> {
        const ok = !!input?.contextId;
        return {
            shouldRun: ok,
            reason: ok ? "valid short-term memory input" : "missing contextId",
            priority: 100,
            estimatedCost: { latencyMs: 2, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: ShortTermMemoryPluginInput, ctx: PluginContext): Promise<PluginResult<MemoryRecallResult[]>> {
        const startedAt = new Date().toISOString();
        const results: MemoryRecallResult[] = [];

        // Active quants → short-term memory items
        for (const q of input.recentQuants) {
            const recency = recencyWeight(q.updatedAt, ctx.now);
            const relevance = clamp(q.magnitude * q.confidence);
            results.push({
                id: q.id,
                contextId: input.contextId,
                memoryType: "short_term",
                item: q,
                relevance,
                confidence: clamp(q.confidence),
                recency,
                frequency: 1,
                outcomeReliability: 0.7,
                evidenceIds: [q.id],
                provenance: {
                    sourceSystem: "quant-pod",
                    sourceId: q.id,
                    ingestedAt: ctx.now,
                },
                explanation: `Recent ${q.type} quant${q.label ? ` '${q.label}'` : ""} with magnitude ${q.magnitude.toFixed(3)}, recency ${recency.toFixed(3)}`,
            });
        }

        // Active branches → short-term memory items
        for (const b of input.activeBranches) {
            const relevance = clamp(b.branchScore);
            results.push({
                id: b.id,
                contextId: input.contextId,
                memoryType: "short_term",
                item: b,
                relevance,
                confidence: clamp(b.probability),
                recency: 1.0,
                frequency: 1,
                outcomeReliability: 0.7,
                evidenceIds: [b.id],
                provenance: {
                    sourceSystem: "prediction-pod",
                    sourceId: b.id,
                    ingestedAt: ctx.now,
                },
                explanation: `Active branch '${b.predicate}' (status=${b.status}, score=${b.branchScore.toFixed(3)})`,
            });
        }

        return successResult(manifest, results, results.length > 0 ? 0.9 : 0, ctx, startedAt, "short_term_recall");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
