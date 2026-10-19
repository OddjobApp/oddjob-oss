import { randomUUID } from "crypto";
import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { SoftSuppressionInput, PruningDecision, BranchScoreBreakdown } from "../types.js";
import {
    SUPPRESSION_REALM_AGREEMENT_THRESHOLD,
    SUPPRESSION_ENTROPY_THRESHOLD,
} from "../types.js";
import { clamp, makePruningManifest, successResult } from "./plugin-helpers.js";

const manifest = makePruningManifest({
    name: "soft-suppression",
    subPod: "soft-suppression",
    capability: "pruning.soft_suppress",
    description: "Reduces branch scores without removing branches when evidence weakly opposes them (spec §10).",
    inputTypes: ["SoftSuppressionInput"],
    outputTypes: ["PruningDecision[]"],
    timeoutMs: 10,
});

interface SuppressionReasons {
    amount: number;
    reasons: string[];
    evidenceIds: string[];
}

function computeSuppression(
    branch: SoftSuppressionInput["branches"][number],
    breakdown: BranchScoreBreakdown | undefined,
    input: SoftSuppressionInput,
): SuppressionReasons | null {
    const reasons: string[] = [];
    let totalSuppression = 0;
    const evidenceIds: string[] = [];

    // Soft constraints from realm mesh
    const softConstraints = branch.constraints?.filter(c => c.severity === "soft") ?? [];
    if (softConstraints.length > 0) {
        const penalty = clamp(softConstraints.length * 0.08, 0, 0.3);
        totalSuppression += penalty;
        reasons.push(`${softConstraints.length} soft constraint(s): ${softConstraints.map(c => c.type).join(", ")}`);
        evidenceIds.push(...softConstraints.flatMap(c => c.evidenceIds));
    }

    // High interference relative to support
    const interferingCount = branch.interferingQuantIds?.length ?? 0;
    const supportingCount = branch.supportingQuantIds?.length ?? 0;
    if (interferingCount > supportingCount && interferingCount > 0) {
        const ratio = interferingCount / Math.max(supportingCount, 1);
        const penalty = clamp(Math.min(ratio * 0.1, 0.25));
        totalSuppression += penalty;
        reasons.push(`interference ratio ${ratio.toFixed(2)} (${interferingCount} interfering vs ${supportingCount} supporting quants)`);
        evidenceIds.push(...(branch.interferingQuantIds ?? []));
    }

    // Low realm agreement for this branch
    const branchContribs = input.realmContributions.filter(c =>
        c.branchId === branch.id || c.targetId === branch.id
    );
    if (branchContribs.length > 0) {
        const boosts = branchContribs.filter(c => c.effect === "boost" || c.effect === "preserve").length;
        const suppresses = branchContribs.filter(c => c.effect === "suppress" || c.effect === "constrain").length;
        const agreement = (boosts - suppresses) / branchContribs.length * 0.5 + 0.5;
        if (agreement < SUPPRESSION_REALM_AGREEMENT_THRESHOLD) {
            const penalty = clamp((SUPPRESSION_REALM_AGREEMENT_THRESHOLD - agreement) * 0.5, 0, 0.2);
            totalSuppression += penalty;
            reasons.push(`low realm agreement ${agreement.toFixed(3)}`);
        }
    }

    // High entropy signals unstable branch
    if (branch.entropy > SUPPRESSION_ENTROPY_THRESHOLD) {
        const penalty = clamp((branch.entropy - SUPPRESSION_ENTROPY_THRESHOLD) * 0.3, 0, 0.15);
        totalSuppression += penalty;
        reasons.push(`high branch entropy ${branch.entropy.toFixed(3)}`);
    }

    // Realm conflicts that specifically name this branch
    const relevantConflicts = input.realmConflicts.filter(r => r.evidenceIds.some(id => branch.supportingQuantIds.includes(id)));
    if (relevantConflicts.length > 0) {
        const penalty = clamp(relevantConflicts.reduce((s, r) => s + (r.severity === "high" ? 0.15 : r.severity === "medium" ? 0.08 : 0.03), 0), 0, 0.2);
        totalSuppression += penalty;
        reasons.push(`${relevantConflicts.length} realm conflict(s)`);
        evidenceIds.push(...relevantConflicts.flatMap(r => r.evidenceIds));
    }

    if (totalSuppression < 0.05) return null;

    return {
        amount: clamp(totalSuppression, 0, 0.6),
        reasons,
        evidenceIds: [...new Set(evidenceIds)],
    };
}

export const softSuppressionPlugin: PredictionPlugin<SoftSuppressionInput, PruningDecision[]> = {
    manifest,

    async canHandle(input: SoftSuppressionInput): Promise<PluginDecision> {
        const ok = !!input?.predictionId && Array.isArray(input?.branches);
        return {
            shouldRun: ok,
            reason: ok ? "valid soft-suppression input" : "missing predictionId or branches",
            priority: 90,
            estimatedCost: { latencyMs: 2, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: SoftSuppressionInput, ctx: PluginContext): Promise<PluginResult<PruningDecision[]>> {
        const startedAt = new Date().toISOString();
        const scoreMap = new Map<string, BranchScoreBreakdown>(
            input.scoreBreakdowns.map(s => [s.branchId, s])
        );

        const decisions: PruningDecision[] = [];

        for (const branch of input.branches) {
            if (branch.status === "pruned" || branch.status === "reserved") continue;

            const breakdown = scoreMap.get(branch.id);
            const suppression = computeSuppression(branch, breakdown, input);
            if (!suppression) continue;

            const scoreBefore = breakdown?.finalScore ?? branch.branchScore;
            const scoreAfter = clamp(scoreBefore * (1 - suppression.amount));

            decisions.push({
                id: randomUUID(),
                branchId: branch.id,
                previousStatus: branch.status as "candidate" | "active" | "suppressed",
                newStatus: "suppressed",
                decisionType: "soft_suppress",
                reason: suppression.reasons.join("; "),
                confidence: clamp(suppression.amount * 1.5),
                scoreBefore,
                scoreAfter,
                evidenceIds: suppression.evidenceIds,
                pluginName: manifest.name,
                pluginVersion: manifest.version,
                createdAt: ctx.now,
            });
        }

        return successResult(
            manifest,
            decisions,
            decisions.length > 0 ? 0.8 : 1,
            ctx,
            startedAt,
            "soft_suppression",
        );
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
