import { randomUUID } from "crypto";
import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { EntropyPruningInput, PruningDecision, BranchScoreBreakdown } from "../types.js";
import { BRANCH_LIMITS } from "../types.js";
import { clamp, makePruningManifest, successResult } from "./plugin-helpers.js";

const manifest = makePruningManifest({
    name: "entropy-pruning",
    subPod: "entropy-pruning",
    capability: "pruning.entropy_prune",
    description: "Adjusts pruning aggressiveness based on field entropy and enforces mode branch limits (spec §17).",
    inputTypes: ["EntropyPruningInput"],
    outputTypes: ["PruningDecision[]"],
    timeoutMs: 10,
});

function effectiveBranchLimit(input: EntropyPruningInput): number {
    const limits = BRANCH_LIMITS[input.mode];
    const baseLimit = input.modePlan.maxBranches ?? limits.active;
    const fieldEntropy = input.quantField?.fieldEntropy ?? 0.5;
    // High entropy → keep more branches; low entropy → prune more aggressively
    const entropyMultiplier = clamp(0.75 + fieldEntropy * 0.5, 0.75, 1.5);
    return Math.round(baseLimit * entropyMultiplier);
}

export const entropyPruningPlugin: PredictionPlugin<EntropyPruningInput, PruningDecision[]> = {
    manifest,

    async canHandle(input: EntropyPruningInput): Promise<PluginDecision> {
        const ok = !!input?.predictionId && Array.isArray(input?.branches) && !!input?.modePlan;
        return {
            shouldRun: ok,
            reason: ok ? "valid entropy pruning input" : "missing predictionId, branches, or modePlan",
            priority: 80,
            estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: EntropyPruningInput, ctx: PluginContext): Promise<PluginResult<PruningDecision[]>> {
        const startedAt = new Date().toISOString();
        const scoreMap = new Map<string, BranchScoreBreakdown>(
            input.scoreBreakdowns.map(s => [s.branchId, s])
        );

        // Only consider active/candidate/suppressed branches for limit enforcement
        const eligible = input.branches.filter(b =>
            b.status === "active" || b.status === "candidate" || b.status === "suppressed"
        );

        const effectiveLimit = effectiveBranchLimit(input);
        const decisions: PruningDecision[] = [];

        if (eligible.length <= effectiveLimit) {
            return successResult(manifest, decisions, 1, ctx, startedAt, "entropy_pruning");
        }

        // Sort by final score ascending — lowest scores pruned first
        const sorted = [...eligible].sort((a, b) => {
            const sa = scoreMap.get(a.id)?.finalScore ?? a.branchScore;
            const sb = scoreMap.get(b.id)?.finalScore ?? b.branchScore;
            return sa - sb;
        });

        const toPrune = sorted.slice(0, eligible.length - effectiveLimit);
        const fieldEntropy = input.quantField?.fieldEntropy ?? 0.5;

        for (const branch of toPrune) {
            const breakdown = scoreMap.get(branch.id);
            const scoreBefore = breakdown?.finalScore ?? branch.branchScore;
            decisions.push({
                id: randomUUID(),
                branchId: branch.id,
                previousStatus: branch.status as "candidate" | "active" | "suppressed",
                newStatus: "pruned",
                decisionType: "hard_prune",
                reason: `branch limit enforcement: effective limit ${effectiveLimit} (entropy=${fieldEntropy.toFixed(3)}), score rank insufficient`,
                confidence: clamp(1 - fieldEntropy),
                scoreBefore,
                scoreAfter: 0,
                evidenceIds: [],
                pluginName: manifest.name,
                pluginVersion: manifest.version,
                createdAt: ctx.now,
            });
        }

        return successResult(
            manifest,
            decisions,
            clamp(1 - fieldEntropy),
            ctx,
            startedAt,
            "entropy_branch_limit_enforcement",
        );
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
