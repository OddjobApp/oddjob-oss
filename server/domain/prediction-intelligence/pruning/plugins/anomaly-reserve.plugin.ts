import { randomUUID } from "crypto";
import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { AnomalyReservePluginInput, PruningDecision, BranchScoreBreakdown } from "../types.js";
import {
    CONSEQUENCE_LABELS,
    ANOMALY_RESERVE_PROBABILITY_THRESHOLD,
    ANOMALY_RESERVE_CONSEQUENCE_THRESHOLD,
} from "../types.js";
import { clamp, makePruningManifest, successResult, hasHighConsequence } from "./plugin-helpers.js";

const manifest = makePruningManifest({
    name: "anomaly-reserve",
    subPod: "anomaly-reserve",
    capability: "pruning.reserve_anomalies",
    description: "Preserves rare but high-consequence branches by moving them to reserved status (spec §11).",
    inputTypes: ["AnomalyReservePluginInput"],
    outputTypes: ["PruningDecision[]"],
    timeoutMs: 10,
});

function computeAnomalyScore(branchId: string, input: AnomalyReservePluginInput): number {
    const supportingQuants = input.activeQuants.filter(q =>
        input.branches.find(b => b.id === branchId)?.supportingQuantIds.includes(q.id)
    );
    const anomalyQuants = supportingQuants.filter(q => q.type === "anomaly_signal");
    if (anomalyQuants.length === 0) return 0;
    return clamp(anomalyQuants.reduce((s, q) => s + q.magnitude * q.confidence, 0) / anomalyQuants.length);
}

function isReservable(
    branch: AnomalyReservePluginInput["branches"][number],
    breakdown: BranchScoreBreakdown | undefined,
    anomalyScore: number,
): { reserve: boolean; reason: string } {
    // Already in reserve or pruned — skip
    if (branch.status === "reserved" || branch.status === "pruned") {
        return { reserve: false, reason: "" };
    }

    const isLowProbability = branch.probability < ANOMALY_RESERVE_PROBABILITY_THRESHOLD;
    const isHighConsequence = hasHighConsequence(branch.postPredicates, CONSEQUENCE_LABELS);
    const hasMeaningfulAnomaly = anomalyScore >= ANOMALY_RESERVE_CONSEQUENCE_THRESHOLD;
    // Also reserve if the expected value is very negative (costly failure scenario)
    const isCostlyFailure = branch.expectedValue < -0.5;

    if (isLowProbability && isHighConsequence) {
        return {
            reserve: true,
            reason: `low probability (${branch.probability.toFixed(4)}) with high-consequence post-predicates`,
        };
    }

    if (isLowProbability && hasMeaningfulAnomaly) {
        return {
            reserve: true,
            reason: `low probability (${branch.probability.toFixed(4)}) with anomaly score ${anomalyScore.toFixed(3)}`,
        };
    }

    if (isLowProbability && isCostlyFailure) {
        return {
            reserve: true,
            reason: `low probability (${branch.probability.toFixed(4)}) with costly expected value (${branch.expectedValue.toFixed(3)})`,
        };
    }

    return { reserve: false, reason: "" };
}

export const anomalyReservePlugin: PredictionPlugin<AnomalyReservePluginInput, PruningDecision[]> = {
    manifest,

    async canHandle(input: AnomalyReservePluginInput): Promise<PluginDecision> {
        const ok = !!input?.predictionId && Array.isArray(input?.branches);
        return {
            shouldRun: ok,
            reason: ok ? "valid anomaly reserve input" : "missing predictionId or branches",
            priority: 85,
            estimatedCost: { latencyMs: 2, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: AnomalyReservePluginInput, ctx: PluginContext): Promise<PluginResult<PruningDecision[]>> {
        const startedAt = new Date().toISOString();
        const scoreMap = new Map<string, BranchScoreBreakdown>(
            input.scoreBreakdowns.map(s => [s.branchId, s])
        );

        const decisions: PruningDecision[] = [];

        for (const branch of input.branches) {
            if (branch.status === "pruned") continue;

            const anomalyScore = computeAnomalyScore(branch.id, input);
            const breakdown = scoreMap.get(branch.id);
            const { reserve, reason } = isReservable(branch, breakdown, anomalyScore);

            if (reserve) {
                const scoreBefore = breakdown?.finalScore ?? branch.branchScore;
                decisions.push({
                    id: randomUUID(),
                    branchId: branch.id,
                    previousStatus: branch.status as "candidate" | "active" | "suppressed",
                    newStatus: "reserved",
                    decisionType: "reserve",
                    reason,
                    confidence: clamp(0.5 + anomalyScore * 0.5),
                    scoreBefore,
                    scoreAfter: scoreBefore,
                    evidenceIds: branch.supportingQuantIds.slice(0, 8),
                    pluginName: manifest.name,
                    pluginVersion: manifest.version,
                    createdAt: ctx.now,
                });
            }
        }

        return successResult(
            manifest,
            decisions,
            decisions.length > 0 ? 0.85 : 1,
            ctx,
            startedAt,
            "anomaly_reserve",
            input.activeQuants.filter(q => q.type === "anomaly_signal").map(q => q.id),
        );
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
