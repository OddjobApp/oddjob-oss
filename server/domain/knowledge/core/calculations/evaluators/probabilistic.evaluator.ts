import { FormulaContext } from "./basic.evaluator.js";

export const probabilisticEvaluator = {
    calculateMonteCarlo(iterations: number = 1000, mean: number = 100, stdDev: number = 15): { meanResult: number; p5: number; p95: number } {
        const results: number[] = [];
        for (let i = 0; i < iterations; i++) {
            // Box-Muller transform for normal distribution simulation
            const u1 = Math.random();
            const u2 = Math.random();
            const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
            results.push(mean + z * stdDev);
        }
        results.sort((a, b) => a - b);
        const meanResult = results.reduce((a, b) => a + b, 0) / iterations;
        const p5 = results[Math.floor(iterations * 0.05)];
        const p95 = results[Math.floor(iterations * 0.95)];
        return { meanResult, p5, p95 };
    },

    calculateBayesianInference(prior: number, likelihood: number, evidence: number): number {
        if (!evidence) return prior;
        return (likelihood * prior) / evidence;
    },

    calculateConfidenceInterval(mean: number, stdDev: number, sampleSize: number, zScore: number = 1.96): { lower: number; upper: number } {
        if (!sampleSize) return { lower: mean, upper: mean };
        const margin = zScore * (stdDev / Math.sqrt(sampleSize));
        return { lower: mean - margin, upper: mean + margin };
    },
};
