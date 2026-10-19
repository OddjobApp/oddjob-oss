import { FormulaContext } from "./basic.evaluator.js";

export const mlEvaluator = {
    predict(features: FormulaContext, weights: Record<string, number>, bias: number = 0): number {
        let score = bias;
        for (const [key, val] of Object.entries(features)) {
            if (key in weights) {
                score += (val || 0) * weights[key];
            }
        }
        return score;
    },

    classify(score: number, threshold: number = 0.5): { label: string; probability: number } {
        const prob = 1 / (1 + Math.exp(-score));
        return {
            label: prob >= threshold ? "POSITIVE" : "NEGATIVE",
            probability: prob,
        };
    },

    detectAnomaly(val: number, mean: number, stdDev: number, zThreshold: number = 3.0): { isAnomaly: boolean; zScore: number } {
        if (!stdDev) return { isAnomaly: false, zScore: 0 };
        const zScore = Math.abs((val - mean) / stdDev);
        return {
            isAnomaly: zScore >= zThreshold,
            zScore,
        };
    },
};
