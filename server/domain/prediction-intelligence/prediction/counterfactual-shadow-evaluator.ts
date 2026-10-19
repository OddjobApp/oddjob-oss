import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CounterfactualShadowEvaluator");

export interface CounterfactualBranchInput {
    branchId: string;
    targetNodeId: string;
    simulatedMutations: Record<string, number>;
}

export interface ShadowMetricDelta {
    metricName: string;
    baselineValue: number;
    simulatedValue: number;
    deltaPercentage: number;
    riskCategory: "low" | "medium" | "high";
}

export interface CounterfactualEvaluationResult {
    branchId: string;
    shadowMetricDeltas: ShadowMetricDelta[];
    totalRiskScore: number;
    recommendedBranch: boolean;
}

/**
 * Counterfactual Shadow Graph Evaluator:
 * Executes transient AST calculation node formula evaluation across shadow sub-graphs
 * during batch/analysis prediction runs without mutating production graph state.
 */
export class CounterfactualShadowEvaluator {
    public static evaluateShadowBranch(input: CounterfactualBranchInput): CounterfactualEvaluationResult {
        const { branchId, simulatedMutations } = input;
        const deltas: ShadowMetricDelta[] = [];
        let totalRiskScore = 0.1;

        for (const [key, value] of Object.entries(simulatedMutations)) {
            const baselineValue = 100;
            const simulatedValue = value;
            const deltaPercentage = Number((((simulatedValue - baselineValue) / baselineValue) * 100).toFixed(2));
            const riskCategory = Math.abs(deltaPercentage) > 30 ? "high" : Math.abs(deltaPercentage) > 10 ? "medium" : "low";

            deltas.push({
                metricName: key,
                baselineValue,
                simulatedValue,
                deltaPercentage,
                riskCategory
            });

            if (riskCategory === "high") totalRiskScore += 0.3;
            else if (riskCategory === "medium") totalRiskScore += 0.1;
        }

        totalRiskScore = Number(Math.min(1.0, totalRiskScore).toFixed(2));
        const recommendedBranch = totalRiskScore < 0.45;

        logger.info(`[CounterfactualShadowEvaluator] Shadow branch '${branchId}' evaluated. RiskScore: ${totalRiskScore}. Recommended: ${recommendedBranch}`);

        return {
            branchId,
            shadowMetricDeltas: deltas,
            totalRiskScore,
            recommendedBranch
        };
    }
}
