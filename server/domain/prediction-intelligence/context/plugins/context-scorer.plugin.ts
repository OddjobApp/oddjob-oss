import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { ContextCandidate, PredictionContext, ContextResolutionInput } from "../types.js";
import { CANDIDATE_SCORE_THRESHOLD } from "../types.js";
import { clamp, makeContextManifest, successResult } from "./plugin-helpers.js";

export interface ContextScorerInput {
    candidates: ContextCandidate[];
    existingContexts: Map<string, PredictionContext>;
    input: ContextResolutionInput;
}

const manifest = makeContextManifest({
    name: "context-scorer",
    subPod: "context-scorer",
    capability: "context.score_candidates",
    description: "Refines candidate scores using actor, object, tenant, workflow, and temporal match factors (spec §14).",
    inputTypes: ["ContextScorerInput"],
    outputTypes: ["ContextCandidate[]"],
    timeoutMs: 6,
});

export const contextScorerPlugin: PredictionPlugin<ContextScorerInput, ContextCandidate[]> = {
    manifest,

    async canHandle(): Promise<PluginDecision> {
        return { shouldRun: true, reason: "always score candidates", priority: 95, estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 } };
    },

    async execute(input: ContextScorerInput, ctx: PluginContext): Promise<PluginResult<ContextCandidate[]>> {
        const startedAt = new Date().toISOString();
        const req = input.input;

        const scored: ContextCandidate[] = input.candidates.map(candidate => {
            if (!candidate.contextId) return candidate; // "create new" candidate — keep as is

            const ctx_ = input.existingContexts.get(candidate.contextId);
            if (!ctx_) return candidate;

            let score = candidate.score;

            // Actor match bonus
            if (req.actorId && ctx_.actorId === req.actorId) score = clamp(score + 0.08);
            // Tenant isolation penalty: cross-tenant match gets penalised
            if (req.tenantId && ctx_.tenantId && ctx_.tenantId !== req.tenantId) score = clamp(score * 0.1);
            // Workflow confirmation
            if (req.workflowId && ctx_.workflowId === req.workflowId) score = clamp(score + 0.05);
            // Session confirmation
            if (req.sessionId && ctx_.sessionId === req.sessionId) score = clamp(score + 0.05);
            // Agent ID confirmation
            if (req.agentId && ctx_.agentId === req.agentId) score = clamp(score + 0.05);
            // Idle contexts get slight penalty
            if (ctx_.status === "idle") score = clamp(score * 0.85);
            // Merged/split/archived contexts cannot be reused
            if (ctx_.status === "merged" || ctx_.status === "split" || ctx_.status === "archived") score = 0;

            return { ...candidate, score: clamp(score) };
        });

        scored.sort((a, b) => b.score - a.score);
        return successResult(manifest, scored, scored[0]?.confidence ?? 0.5, ctx, startedAt, "context_scoring");
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
