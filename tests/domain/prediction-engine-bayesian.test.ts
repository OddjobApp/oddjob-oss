import { describe, it, expect, beforeEach } from "vitest";
import { PredictionEngine, TrajectoryVector } from "@server/domain/ai/core/prediction-engine.service.js";
import { trajectoryCalibrationService } from "@server/domain/ai/core/trajectory-calibration.service.js";

describe("PredictionEngine Empirical Bayesian Calibration", () => {
    beforeEach(() => {
        PredictionEngine.resetCalibration();
    });

    const createTrajectory = (options: {
        stage?: "Observe" | "Diagnose" | "Improve" | "Approve";
        targetFileOrNode?: string;
        proposedAction?: string;
        confidenceScore?: number;
        riskClass?: "routine" | "elevated" | "critical";
    } = {}): TrajectoryVector => ({
        currentState: {
            stage: options.stage ?? "Diagnose",
            targetFileOrNode: options.targetFileOrNode ?? "client/src/App.tsx",
            riskClass: options.riskClass ?? "routine",
        },
        candidateNextStep: {
            stage: "Improve",
            targetFileOrNode: options.targetFileOrNode ?? "client/src/App.tsx",
            proposedAction: options.proposedAction ?? "modify_component",
            confidenceScore: options.confidenceScore,
            riskClass: options.riskClass ?? "routine",
        },
    });

    it("1. Starts with default weakly informative priors (cold-start compatibility)", () => {
        const trajectory = createTrajectory({ riskClass: "routine" });
        const result = PredictionEngine.evaluateTrajectory(trajectory);

        expect(result.calibration?.isEmpiricallyGrounded).toBe(false);
        expect(result.calibration?.sampleSize).toBe(0);
        expect(result.safeTransitionScore).toBe(0.855); // 0.95 * (1 - 0.1)
        expect(result.recommendedAction).toBe("auto_execute");
    });

    it("2. Updates posterior P(Success) when recording successes", () => {
        // Record 10 successful transitions
        for (let i = 0; i < 10; i++) {
            PredictionEngine.recordOutcome({
                action: "modify_component",
                riskClass: "routine",
                success: true,
                blastImpact: 0.05,
            });
        }

        const trajectory = createTrajectory({
            riskClass: "routine",
            proposedAction: "modify_component",
        });
        const result = PredictionEngine.evaluateTrajectory(trajectory);

        expect(result.calibration?.isEmpiricallyGrounded).toBe(true);
        expect(result.calibration?.sampleSize).toBe(10);
        // Alpha starts at 19 + 10 = 29, Beta = 1 -> E[P] = 29/30 = ~0.9667
        expect(result.probabilitySuccess).toBeGreaterThan(0.96);
        expect(result.recommendedAction).toBe("auto_execute");
    });

    it("3. Depresses P(Success) on repeated failures and forces supervisor approval", () => {
        // Record repeated failures for an action
        for (let i = 0; i < 5; i++) {
            PredictionEngine.recordOutcome({
                action: "flaky_migration",
                riskClass: "routine",
                success: false,
                blastImpact: 0.25,
            });
        }

        const trajectory = createTrajectory({
            riskClass: "routine",
            proposedAction: "flaky_migration",
        });
        const result = PredictionEngine.evaluateTrajectory(trajectory);

        expect(result.calibration?.isEmpiricallyGrounded).toBe(true);
        expect(result.calibration?.sampleSize).toBe(5);
        // Alpha starts at 19, Beta starts at 1 + 5 = 6. E[P] = 19/25 = 0.76
        // Safe score = 0.76 * (1 - 0.1) = ~0.684 < required routine threshold 0.85
        expect(result.safeTransitionScore).toBeLessThan(0.85);
        expect(result.recommendedAction).toBe("require_approval");
        expect(result.reason).toContain("Supervisor attestation required");
    });

    it("4. Penalizes hallucinated model overconfidence against empirical failure history", () => {
        // Record historical failures
        for (let i = 0; i < 8; i++) {
            PredictionEngine.recordOutcome({
                action: "dangerous_refactor",
                riskClass: "elevated",
                success: false,
                blastImpact: 0.3,
            });
        }

        // Model reports maximum 1.0 confidence
        const trajectory = createTrajectory({
            riskClass: "elevated",
            proposedAction: "dangerous_refactor",
            confidenceScore: 1.0,
        });

        const result = PredictionEngine.evaluateTrajectory(trajectory);

        // Grounding blends reported 1.0 confidence with empirical posterior (~0.51)
        expect(result.probabilitySuccess).toBeLessThan(0.80);
        expect(result.recommendedAction).toBe("require_approval");
    });

    it("5. Dynamically expands calibrated blast radius when observed blast impact exceeds baseline", () => {
        // Record outcomes with severe blast impact (e.g. 0.40 vs baseline 0.10)
        for (let i = 0; i < 4; i++) {
            PredictionEngine.recordOutcome({
                action: "schema_sync",
                riskClass: "routine",
                success: true,
                blastImpact: 0.40,
            });
        }

        const trajectory = createTrajectory({
            riskClass: "routine",
            proposedAction: "schema_sync",
        });
        const result = PredictionEngine.evaluateTrajectory(trajectory);

        // Calibrated blast radius should conservatively elevate to the observed mean (0.40)
        expect(result.blastRadius).toBeCloseTo(0.40, 2);
        // Elevated blast radius reduces safe transition score: 0.95 * (1 - 0.40) = ~0.57 < 0.85
        expect(result.recommendedAction).toBe("require_approval");
    });

    it("6. Resets calibration cleanly for test isolation", () => {
        PredictionEngine.recordOutcome({
            action: "temp_action",
            riskClass: "routine",
            success: false,
        });
        expect(trajectoryCalibrationService.getCalibratedPriors("routine", "temp_action").sampleSize).toBe(1);

        PredictionEngine.resetCalibration();
        expect(trajectoryCalibrationService.getCalibratedPriors("routine", "temp_action").sampleSize).toBe(0);
        expect(trajectoryCalibrationService.getCalibratedPriors("routine", "temp_action").isEmpiricallyGrounded).toBe(false);
    });
});
