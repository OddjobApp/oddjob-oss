import { FormulaContext } from "./basic.evaluator.js";

export const temporalEvaluator = {
    calculateMovingAverage(timeSeries: number[], windowSize: number = 3): number {
        if (!timeSeries.length) return 0;
        const slice = timeSeries.slice(-windowSize);
        return slice.reduce((sum, val) => sum + val, 0) / slice.length;
    },

    calculateYoY(current: number, priorYear: number): number {
        if (!priorYear) return 0;
        return ((current - priorYear) / priorYear) * 100;
    },

    calculateMoM(current: number, priorMonth: number): number {
        if (!priorMonth) return 0;
        return ((current - priorMonth) / priorMonth) * 100;
    },

    calculateCAGR(startVal: number, endVal: number, numYears: number): number {
        if (!startVal || startVal <= 0 || numYears <= 0) return 0;
        return (Math.pow(endVal / startVal, 1 / numYears) - 1) * 100;
    },

    calculateExponentialSmoothing(timeSeries: number[], alpha: number = 0.3): number {
        if (!timeSeries.length) return 0;
        let s = timeSeries[0];
        for (let i = 1; i < timeSeries.length; i++) {
            s = alpha * timeSeries[i] + (1 - alpha) * s;
        }
        return s;
    },

    calculateRollingSum(timeSeries: number[], windowSize: number = 3): number {
        if (!timeSeries.length) return 0;
        const slice = timeSeries.slice(-windowSize);
        return slice.reduce((sum, val) => sum + val, 0);
    },
};
