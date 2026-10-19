import { createLogger } from "@server/utils/logger.js";
import { redisService } from "@domain/core/infrastructure/redis/redis-client.js";
import { TrajectoryRiskClass } from "./prediction-strategy.js";

const logger = createLogger("TrajectoryCalibrationService");

export interface TrajectoryOutcomeEvent {
    action?: string;
    targetFileOrNode?: string;
    riskClass: TrajectoryRiskClass;
    success: boolean;
    blastImpact?: number; // 0.0 - 1.0 observed impact
    agentId?: string;
    timestamp?: Date;
}

export interface CalibratedPriorsResult {
    /** Posterior mean P(Success) calculated from Beta-Binomial conjugate update */
    posteriorProbability: number;
    /** Lower credible bound (P_mean - 1.0 * stdDev) for risk-averse threshold gating */
    credibleLowerBound: number;
    /** Empirical or strategy-adjusted blast radius */
    calibratedBlastRadius: number;
    /** Number of observed historical transitions */
    sampleSize: number;
    /** Distribution parameters */
    alpha: number;
    beta: number;
    /** Flag indicating whether empirical data influenced the score */
    isEmpiricallyGrounded: boolean;
}

interface BetaPriorState {
    alpha0: number;
    beta0: number;
    successes: number;
    failures: number;
    totalBlastImpact: number;
    blastSamples: number;
}

// Default weakly informative priors tuned per risk class
const DEFAULT_PRIORS: Record<TrajectoryRiskClass, { alpha0: number; beta0: number }> = {
    routine: { alpha0: 19, beta0: 1 },    // Mean = 0.95
    elevated: { alpha0: 8.5, beta0: 1.5 }, // Mean = 0.85
    critical: { alpha0: 7.0, beta0: 3.0 }, // Mean = 0.70
};

const REDIS_KEY_PREFIX = "oddjob:ai:trajectory_calibration:";

export class TrajectoryCalibrationService {
    private static instance: TrajectoryCalibrationService;
    private stateMap = new Map<string, BetaPriorState>();
    private initialized = false;

    public static getInstance(): TrajectoryCalibrationService {
        if (!TrajectoryCalibrationService.instance) {
            TrajectoryCalibrationService.instance = new TrajectoryCalibrationService();
        }
        return TrajectoryCalibrationService.instance;
    }

    private constructor() {
        this.initializePriors();
    }

    private initializePriors(): void {
        for (const [riskClass, prior] of Object.entries(DEFAULT_PRIORS)) {
            this.stateMap.set(riskClass, {
                alpha0: prior.alpha0,
                beta0: prior.beta0,
                successes: 0,
                failures: 0,
                totalBlastImpact: 0,
                blastSamples: 0,
            });
        }
        this.initialized = true;
    }

    /**
     * Derives bucket key for trajectory calibration.
     */
    private buildKey(riskClass: TrajectoryRiskClass, action?: string): string {
        if (action && action.trim().length > 0) {
            const normalizedAction = action.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
            return `${riskClass}:${normalizedAction}`;
        }
        return riskClass;
    }

    /**
     * Records an observed transition outcome to update the Beta-Binomial posterior.
     */
    public recordOutcome(event: TrajectoryOutcomeEvent): CalibratedPriorsResult {
        const { riskClass, action, success, blastImpact } = event;
        const key = this.buildKey(riskClass, action);
        const defaultPrior = DEFAULT_PRIORS[riskClass] ?? DEFAULT_PRIORS.routine;

        let state = this.stateMap.get(key);
        if (!state) {
            // Inherit baseline prior from the risk class
            state = {
                alpha0: defaultPrior.alpha0,
                beta0: defaultPrior.beta0,
                successes: 0,
                failures: 0,
                totalBlastImpact: 0,
                blastSamples: 0,
            };
            this.stateMap.set(key, state);
        }

        if (success) {
            state.successes += 1;
        } else {
            state.failures += 1;
        }

        if (typeof blastImpact === "number" && !Number.isNaN(blastImpact)) {
            state.totalBlastImpact += Math.min(Math.max(blastImpact, 0), 1);
            state.blastSamples += 1;
        }

        // Also record on the broader risk-class level if an action-specific key was used
        if (key !== riskClass) {
            const classState = this.stateMap.get(riskClass);
            if (classState) {
                if (success) classState.successes += 1;
                else classState.failures += 1;
                if (typeof blastImpact === "number") {
                    classState.totalBlastImpact += Math.min(Math.max(blastImpact, 0), 1);
                    classState.blastSamples += 1;
                }
            }
        }

        // Asynchronously persist to Redis without blocking
        this.persistToRedis(key, state).catch((err) => {
            logger.debug(`Redis calibration persist failed for key ${key}: ${err.message}`);
        });

        logger.debug(`[TrajectoryCalibration] Recorded outcome for '${key}': success=${success}, S=${state.successes}, F=${state.failures}`);
        return this.calculatePriors(state, defaultPrior.alpha0, defaultPrior.beta0, 0.1);
    }

    /**
     * Gets calibrated priors given riskClass, action, and baseline strategy blast radius.
     */
    public getCalibratedPriors(
        riskClass: TrajectoryRiskClass,
        action?: string,
        baselineBlastRadius = 0.1
    ): CalibratedPriorsResult {
        const key = this.buildKey(riskClass, action);
        const defaultPrior = DEFAULT_PRIORS[riskClass] ?? DEFAULT_PRIORS.routine;

        const state = this.stateMap.get(key) ?? this.stateMap.get(riskClass);
        if (!state) {
            return this.calculatePriors(
                {
                    alpha0: defaultPrior.alpha0,
                    beta0: defaultPrior.beta0,
                    successes: 0,
                    failures: 0,
                    totalBlastImpact: 0,
                    blastSamples: 0,
                },
                defaultPrior.alpha0,
                defaultPrior.beta0,
                baselineBlastRadius
            );
        }

        return this.calculatePriors(state, defaultPrior.alpha0, defaultPrior.beta0, baselineBlastRadius);
    }

    /**
     * Evaluates Beta distribution statistics.
     */
    private calculatePriors(
        state: BetaPriorState,
        alpha0: number,
        beta0: number,
        baselineBlastRadius: number
    ): CalibratedPriorsResult {
        const alpha = alpha0 + state.successes;
        const beta = beta0 + state.failures;
        const totalSamples = state.successes + state.failures;

        // Posterior Mean: E[P] = alpha / (alpha + beta)
        const posteriorProbability = Number((alpha / (alpha + beta)).toFixed(4));

        // Variance: Var(P) = (alpha * beta) / ((alpha + beta)^2 * (alpha + beta + 1))
        const variance = (alpha * beta) / (Math.pow(alpha + beta, 2) * (alpha + beta + 1));
        const stdDev = Math.sqrt(variance);

        // Lower Credible Bound (1-sigma lower bound for safety-critical gating)
        const credibleLowerBound = Number(Math.max(0, posteriorProbability - stdDev).toFixed(4));

        // Observed blast impact blending
        let calibratedBlastRadius = baselineBlastRadius;
        if (state.blastSamples >= 3) {
            const meanObservedBlast = state.totalBlastImpact / state.blastSamples;
            // Take the maximum of baseline and observed blast impact to stay conservative
            calibratedBlastRadius = Number(Math.max(baselineBlastRadius, meanObservedBlast).toFixed(3));
        }

        return {
            posteriorProbability,
            credibleLowerBound,
            calibratedBlastRadius,
            sampleSize: totalSamples,
            alpha,
            beta,
            isEmpiricallyGrounded: totalSamples > 0,
        };
    }

    private async persistToRedis(key: string, state: BetaPriorState): Promise<void> {
        try {
            const client = redisService.client;
            if (client && client.status === "ready") {
                await client.set(`${REDIS_KEY_PREFIX}${key}`, JSON.stringify(state), "EX", 86400 * 7); // 7 days TTL
            }
        } catch {
            // In-memory state remains valid
        }
    }

    /**
     * Resets calibration state (primarily for test isolation).
     */
    public reset(): void {
        this.stateMap.clear();
        this.initializePriors();
    }
}

export const trajectoryCalibrationService = TrajectoryCalibrationService.getInstance();
