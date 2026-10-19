import { randomUUID } from "crypto";
import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { HardPruneInput, PruningDecision, BranchScoreBreakdown } from "../types.js";
import {
    CONSEQUENCE_LABELS,
    HARD_PRUNE_PROBABILITY_FLOOR,
    HARD_PRUNE_EV_FLOOR,
} from "../types.js";
import { makePruningManifest, successResult, hasHighConsequence } from "./plugin-helpers.js";

const manifest = makePruningManifest({
    name: "hard-prune",
    subPod: "hard-prune",
    capability: "pruning.hard_prune",
    description: "Removes branches that violate hard constraints or are demonstrably impossible (spec §9).",
    inputTypes: ["HardPruneInput"],
    outputTypes: ["PruningDecision[]"],
    timeoutMs: 10,
});

function isHardPrunable(
    branch: HardPruneInput["branches"][number],
    breakdown: BranchScoreBreakdown | undefined,
): { prune: boolean; reason: string } {
    // Hard constraints from realm mesh (e.g. temporal_impossible, geographic_impossible)
    const hardConstraint = branch.constraints?.find(c => c.severity === "hard");
    if (hardConstraint) {
        return { prune: true, reason: `hard constraint violated: ${hardConstraint.type} (${hardConstraint.explanation})` };
    }

    // Probability AND expected-value both below absolute floors — but never prune high-consequence branches
    const probBelowFloor = branch.probability < HARD_PRUNE_PROBABILITY_FLOOR;
    const evBelowFloor = branch.expectedValue < HARD_PRUNE_EV_FLOOR;
    if (probBelowFloor && evBelowFloor) {
        if (hasHighConsequence(branch.postPredicates, CONSEQUENCE_LABELS)) {
            // Preserve — consequence too high to hard-prune regardless of probability
            return { prune: false, reason: "preserved: high-consequence branch despite low probability" };
        }
        return {
            prune: true,
            reason: `probability (${branch.probability.toFixed(4)}) and expected value (${branch.expectedValue.toFixed(3)}) both below floors`,
        };
    }

    return { prune: false, reason: "" };
}

export const hardPrunePlugin: PredictionPlugin<HardPruneInput, PruningDecision[]> = {
    manifest,

    async canHandle(input: HardPruneInput): Promise<PluginDecision> {
        const ok = !!input?.predictionId && Array.isArray(input?.branches);
        return {
            shouldRun: ok,
            reason: ok ? "valid hard-prune input" : "missing predictionId or branches",
            priority: 95,
            estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: HardPruneInput, ctx: PluginContext): Promise<PluginResult<PruningDecision[]>> {
        const startedAt = new Date().toISOString();
        const scoreMap = new Map<string, BranchScoreBreakdown>(
            input.scoreBreakdowns.map(s => [s.branchId, s])
        );

        const decisions: PruningDecision[] = [];

        for (const branch of input.branches) {
            // Only evaluate branches still in candidate/active state
            if (branch.status !== "candidate" && branch.status !== "active") continue;

            const breakdown = scoreMap.get(branch.id);
            const { prune, reason } = isHardPrunable(branch, breakdown);

            if (prune) {
                decisions.push({
                    id: randomUUID(),
                    branchId: branch.id,
                    previousStatus: branch.status as "candidate" | "active",
                    newStatus: "pruned",
                    decisionType: "hard_prune",
                    reason,
                    confidence: 0.95,
                    scoreBefore: breakdown?.finalScore ?? branch.branchScore,
                    scoreAfter: 0,
                    evidenceIds: [...(branch.supportingQuantIds ?? [])],
                    pluginName: manifest.name,
                    pluginVersion: manifest.version,
                    createdAt: ctx.now,
                });
            }
        }

        return successResult(
            manifest,
            decisions,
            decisions.length > 0 ? 0.9 : 1,
            ctx,
            startedAt,
            "hard_constraint_pruning",
        );
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
