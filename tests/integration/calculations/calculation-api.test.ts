import { describe, it, expect } from "vitest";
import { calculationService } from "@server/domain/knowledge/core/calculations/calculation.service.js";
import { calculationsRouter } from "@server/domain/knowledge/routes/calculations.route.js";
import { evaluateNumber } from "@server/domain/knowledge/core/calculations/evaluators/basic.evaluator.js";
import { probabilisticEvaluator } from "@server/domain/knowledge/core/calculations/evaluators/probabilistic.evaluator.js";
import { constraintEvaluator } from "@server/domain/knowledge/core/calculations/evaluators/constraint.evaluator.js";
import { temporalEvaluator } from "@server/domain/knowledge/core/calculations/evaluators/temporal.evaluator.js";
import { mlEvaluator } from "@server/domain/knowledge/core/calculations/evaluators/ml.evaluator.js";

describe("Calculation Nodes API & Service Integration", () => {
    describe("Service Exports & Basic Math", () => {
        it("exports calculationsRouter and calculationService with expected handlers", () => {
            expect(calculationsRouter).toBeDefined();
            expect(calculationService.createCalculation).toBeDefined();
            expect(calculationService.executeCalculation).toBeDefined();
            expect(calculationService.listCalculations).toBeDefined();
            expect(calculationService.deleteCalculation).toBeDefined();
        });

        it("evaluates arithmetic formulas safely", () => {
            const result = calculationService.evalArithmetic("a + b", { a: 10, b: 5 }, "+");
            expect(result).toBe(15);
        });

        it("evaluates complex AST expressions with nested parentheses and operator precedence", () => {
            const val = evaluateNumber("((revenue - cogs) / revenue) * 100", {
                revenue: 200,
                cogs: 50,
            });
            expect(val).toBe(75); // ((200 - 50) / 200) * 100 = (150 / 200) * 100 = 75%
        });

        it("resolves context values correctly", () => {
            const val = calculationService.resolveValue("price", { price: 99.5 });
            expect(val).toBe(99.5);
        });
    });

    describe("Probabilistic Evaluator", () => {
        it("executes Monte Carlo simulation with expected percentile bounds", () => {
            const result = probabilisticEvaluator.calculateMonteCarlo(1000, 100, 15);
            expect(result.meanResult).toBeGreaterThan(85);
            expect(result.meanResult).toBeLessThan(115);
            expect(result.p5).toBeLessThan(result.meanResult);
            expect(result.p95).toBeGreaterThan(result.meanResult);
            expect(result.p5).toBeLessThan(result.p95);
        });

        it("computes Bayesian inference with prior, likelihood, and evidence", () => {
            // P(Disease|Positive) = P(Positive|Disease) * P(Disease) / P(Positive)
            // 0.9 * 0.01 / 0.05 = 0.18
            const posterior = probabilisticEvaluator.calculateBayesianInference(0.01, 0.9, 0.05);
            expect(posterior).toBeCloseTo(0.18, 5);
        });

        it("calculates confidence intervals with margin of error", () => {
            const ci = probabilisticEvaluator.calculateConfidenceInterval(100, 20, 100, 1.96);
            // Margin = 1.96 * (20 / 10) = 3.92 -> lower = 96.08, upper = 103.92
            expect(ci.lower).toBeCloseTo(96.08, 2);
            expect(ci.upper).toBeCloseTo(103.92, 2);
        });
    });

    describe("Constraint & Governance Evaluator", () => {
        it("validates relational operators against thresholds", () => {
            expect(constraintEvaluator.validateThreshold(85, 80, ">=")).toBe(true);
            expect(constraintEvaluator.validateThreshold(75, 80, ">=")).toBe(false);
            expect(constraintEvaluator.validateThreshold(90, 100, "<")).toBe(true);
            expect(constraintEvaluator.validateThreshold(50, 50, "==")).toBe(true);
            expect(constraintEvaluator.validateThreshold(50, 60, "!=")).toBe(true);
        });

        it("validates interval ranges with boundary checks", () => {
            expect(constraintEvaluator.validateRange(50, 10, 100).passed).toBe(true);
            expect(constraintEvaluator.validateRange(5, 10, 100).passed).toBe(false);
            expect(constraintEvaluator.validateRange(5, 10, 100).violation).toBe("below_minimum");
            expect(constraintEvaluator.validateRange(150, 10, 100).passed).toBe(false);
            expect(constraintEvaluator.validateRange(150, 10, 100).violation).toBe("above_maximum");
        });

        it("validates set membership", () => {
            const allowedRoles = ["ADMIN", "OPERATOR", "ANALYST"];
            expect(constraintEvaluator.validateSet("OPERATOR", allowedRoles).passed).toBe(true);
            expect(constraintEvaluator.validateSet("GUEST", allowedRoles).passed).toBe(false);
            expect(constraintEvaluator.validateSet("GUEST", allowedRoles).violation).toBe("not_in_allowed_set");
        });
    });

    describe("Temporal Evaluator", () => {
        it("calculates moving averages across sliding windows", () => {
            const series = [10, 20, 30, 40, 50];
            const ma = temporalEvaluator.calculateMovingAverage(series, 3);
            // Slice (-3) -> [30, 40, 50], average = 40
            expect(ma).toBe(40);
        });

        it("calculates Year-over-Year (YoY) growth percentage", () => {
            const yoy = temporalEvaluator.calculateYoY(150, 100);
            expect(yoy).toBe(50); // 50% growth
        });

        it("calculates Month-over-Month (MoM) growth percentage", () => {
            const mom = temporalEvaluator.calculateMoM(110, 100);
            expect(mom).toBe(10); // 10% growth
        });

        it("calculates Compound Annual Growth Rate (CAGR)", () => {
            // From 100 to 144 in 2 years -> sqrt(1.44) - 1 = 0.20 -> 20%
            const cagr = temporalEvaluator.calculateCAGR(100, 144, 2);
            expect(cagr).toBeCloseTo(20, 2);
        });

        it("calculates Exponential Smoothing", () => {
            const series = [100, 110, 120];
            const smoothed = temporalEvaluator.calculateExponentialSmoothing(series, 0.5);
            // s0 = 100
            // s1 = 0.5 * 110 + 0.5 * 100 = 105
            // s2 = 0.5 * 120 + 0.5 * 105 = 112.5
            expect(smoothed).toBe(112.5);
        });

        it("calculates Rolling Sum", () => {
            const series = [5, 10, 15, 20];
            const sum = temporalEvaluator.calculateRollingSum(series, 2);
            expect(sum).toBe(35); // 15 + 20
        });
    });

    describe("ML Evaluator", () => {
        it("computes weighted linear predictions with bias", () => {
            const features = { riskFactor: 0.8, volume: 100 };
            const weights = { riskFactor: 10, volume: 0.5 };
            const pred = mlEvaluator.predict(features, weights, 2);
            // 2 + (0.8 * 10) + (100 * 0.5) = 2 + 8 + 50 = 60
            expect(pred).toBe(60);
        });

        it("classifies scores into labels with sigmoid probabilities", () => {
            const positive = mlEvaluator.classify(2.0, 0.5);
            expect(positive.label).toBe("POSITIVE");
            expect(positive.probability).toBeGreaterThan(0.5);

            const negative = mlEvaluator.classify(-2.0, 0.5);
            expect(negative.label).toBe("NEGATIVE");
            expect(negative.probability).toBeLessThan(0.5);
        });

        it("detects statistical anomalies using z-score thresholding", () => {
            const normal = mlEvaluator.detectAnomaly(105, 100, 10, 2.5);
            expect(normal.isAnomaly).toBe(false);
            expect(normal.zScore).toBe(0.5);

            const outlier = mlEvaluator.detectAnomaly(135, 100, 10, 2.5);
            expect(outlier.isAnomaly).toBe(true);
            expect(outlier.zScore).toBe(3.5);
        });
    });
});
