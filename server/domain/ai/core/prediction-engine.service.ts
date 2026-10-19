import { createLogger } from "@server/utils/logger.js";
import { LifecycleStage } from "../../agents/core/agent-lifecycle-state-machine.js";
import {
    DEFAULT_PREDICTION_STRATEGY,
    predictionStrategyTrace,
    trajectoryRiskClassSchema,
    validatePredictionStrategy,
    type PredictionStrategy,
    type TrajectoryRiskClass,
} from "./prediction-strategy.js";
import {
    trajectoryCalibrationService,
    type CalibratedPriorsResult,
    type TrajectoryOutcomeEvent,
} from "./trajectory-calibration.service.js";

const logger = createLogger("PredictionEngine");

export interface TrajectoryStep {
    stage: LifecycleStage;
    targetFileOrNode?: string;
    diagnosticHypothesis?: string;
    proposedAction?: string;
    confidenceScore?: number;
    /** Explicit classification is authoritative; target-name inference is a compatibility fallback. */
    riskClass?: TrajectoryRiskClass;
}

export interface TrajectoryVector {
    previousStep?: TrajectoryStep;
    currentState: TrajectoryStep;
    candidateNextStep: TrajectoryStep;
    stepHistory?: TrajectoryStep[];
    strategy?: PredictionStrategy;
}

/** Model size band a trajectory is routed to, cheapest first. */
export type ModelTier = "8b_small" | "haiku_mid" | "frontier_large";

export interface TrajectoryEvaluationResult {
    safeTransitionScore: number;
    probabilitySuccess: number;
    blastRadius: number;
    loopDetected: boolean;
    recommendedAction: "auto_execute" | "require_approval" | "halt_loop";
    selectedModelTier: ModelTier;
    costReductionEst: string;
    reason: string;
    riskClass?: TrajectoryRiskClass;
    requiredThreshold?: number | null;
    strategyTrace?: { strategyId: string; generation: number; riskClass: TrajectoryRiskClass; phenotypeHash: string };
    calibration?: CalibratedPriorsResult;
}

/**
 * Governed trajectory evaluator with empirical Bayesian calibration.
 * Applies versioned strategy heuristics combined with Beta-Binomial empirical
 * posterior distributions from observed execution outcomes.
 */
export class PredictionEngine {
    /**
     * Evaluates candidate transition S_{t+1} given trajectory context.
     */
    public static evaluateTrajectory(trajectory: TrajectoryVector): TrajectoryEvaluationResult {
        const { previousStep, currentState, candidateNextStep, stepHistory } = trajectory;
        const strategy = validatePredictionStrategy(trajectory.strategy ?? DEFAULT_PREDICTION_STRATEGY);
        const riskClass = PredictionEngine.classifyRisk(candidateNextStep);
        const strategyTrace = predictionStrategyTrace(strategy, riskClass);

        // 1. Detect Agent Loops & Thrashing (S_{t-1} = Improve, S_t = Diagnose, S_{t+1} = Improve on same file, or multi-turn history repetition)
        const isImmediateLoop =
            previousStep?.stage === "Improve" &&
            currentState.stage === "Diagnose" &&
            candidateNextStep.stage === "Improve" &&
            previousStep.targetFileOrNode === candidateNextStep.targetFileOrNode;

        const isHistoryLoop = Boolean(
            stepHistory &&
            stepHistory.length >= 3 &&
            candidateNextStep.targetFileOrNode &&
            stepHistory.filter(
                (s) => s.targetFileOrNode === candidateNextStep.targetFileOrNode && s.stage === candidateNextStep.stage
            ).length >= 2
        );

        const isLoop = isImmediateLoop || isHistoryLoop;

        if (isLoop) {
            const loopReason = isHistoryLoop
                ? `Multi-turn cycle repetition detected on '${candidateNextStep.targetFileOrNode}'. Halting execution for supervisor review.`
                : "Agent retry loop detected across identical AST boundary. Execution halted for supervisor review.";
            logger.warn(`[PredictionEngine] Retry loop detected on boundary '${candidateNextStep.targetFileOrNode}'. Halting execution.`);
            return {
                safeTransitionScore: 0.0,
                probabilitySuccess: 0.0,
                blastRadius: 0.8,
                loopDetected: true,
                recommendedAction: "halt_loop",
                selectedModelTier: "frontier_large",
                costReductionEst: "0%",
                reason: loopReason,
                riskClass,
                requiredThreshold: null,
                strategyTrace,
            };
        }

        // 2. Estimate AST Reachability Blast Radius & Empirical Priors
        const target = candidateNextStep.targetFileOrNode ?? "";
        const baselineBlastRadius = strategy.blastRadius[riskClass];
        const calibration = trajectoryCalibrationService.getCalibratedPriors(
            riskClass,
            candidateNextStep.proposedAction,
            baselineBlastRadius
        );
        const blastRadius = calibration.calibratedBlastRadius;

        // 3. Compute Probability of Success (combining model self-confidence and empirical priors)
        let probabilitySuccess: number;
        if (candidateNextStep.confidenceScore !== undefined) {
            if (!Number.isFinite(candidateNextStep.confidenceScore) || candidateNextStep.confidenceScore < 0 || candidateNextStep.confidenceScore > 1) {
                throw new RangeError("candidateNextStep.confidenceScore must be a finite number between 0 and 1");
            }
            if (calibration.isEmpiricallyGrounded) {
                // Blend reported model confidence with empirical Bayesian posterior
                probabilitySuccess = Number(
                    (0.4 * candidateNextStep.confidenceScore + 0.6 * calibration.posteriorProbability).toFixed(4)
                );
            } else {
                probabilitySuccess = candidateNextStep.confidenceScore;
            }
        } else {
            probabilitySuccess = calibration.isEmpiricallyGrounded
                ? calibration.posteriorProbability
                : strategy.defaultProbability;
        }

        // 4. Calculate Safe Transition Score T(S_{t+1}) = P(Success | S_{t-1}, S_t) * (1 - BlastRadius)
        const safeTransitionScore = Number((probabilitySuccess * (1 - blastRadius)).toFixed(3));

        // Enforce strict threshold for production / schema target files
        const requiredThreshold = riskClass === "critical" ? null : strategy.minimumSafeScore[riskClass];

        // 5. Dynamic Model Cost Routing based on graph complexity
        let selectedModelTier: "8b_small" | "haiku_mid" | "frontier_large" = "haiku_mid";
        let costReductionEst = "70%";

        if (!target || riskClass === "routine") {
            selectedModelTier = "8b_small";
            costReductionEst = "95%";
        } else if (riskClass === "critical") {
            selectedModelTier = "frontier_large";
            costReductionEst = "0% (Baseline)";
        }

        const autoExecute = requiredThreshold !== null && safeTransitionScore >= requiredThreshold;
        const recommendedAction = autoExecute ? "auto_execute" : "require_approval";

        logger.info(
            `[PredictionEngine] Trajectory Evaluated. Score T(S_next): ${safeTransitionScore} (Required: ${requiredThreshold ?? "human approval"}). Action: ${recommendedAction}. Tier: ${selectedModelTier}. Grounded: ${calibration.isEmpiricallyGrounded}.`
        );

        return {
            safeTransitionScore,
            probabilitySuccess,
            blastRadius,
            loopDetected: false,
            recommendedAction,
            selectedModelTier,
            costReductionEst,
            reason: autoExecute
                ? `Safe transition score ${safeTransitionScore} >= required threshold ${requiredThreshold}. Auto-execution unblocked.`
                : riskClass === "critical"
                    ? "Critical transitions require supervisor attestation regardless of predicted success."
                    : `Safe transition score ${safeTransitionScore} < required threshold ${requiredThreshold}. Supervisor attestation required.`,
            riskClass,
            requiredThreshold,
            strategyTrace,
            calibration,
        };
    }

    /**
     * Records a transition outcome for empirical calibration.
     */
    public static recordOutcome(event: TrajectoryOutcomeEvent): CalibratedPriorsResult {
        return trajectoryCalibrationService.recordOutcome(event);
    }

    /**
     * Resets calibration state (useful for test isolation).
     */
    public static resetCalibration(): void {
        trajectoryCalibrationService.reset();
    }

    public static classifyRisk(step: TrajectoryStep): TrajectoryRiskClass {
        if (step.riskClass) return trajectoryRiskClassSchema.parse(step.riskClass);
        const targetTokens = (step.targetFileOrNode ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        const actionTokens = (step.proposedAction ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
        const allTokens = [...targetTokens, ...actionTokens];
        if (allTokens.some((token) => ["prod", "production", "database", "schema", "cluster", "destroy", "drop", "purge"].includes(token))) return "critical";
        if (allTokens.some((token) => ["core", "infrastructure", "service", "restart", "terminate", "reboot", "deploy"].includes(token))) return "elevated";
        return "routine";
    }
}
