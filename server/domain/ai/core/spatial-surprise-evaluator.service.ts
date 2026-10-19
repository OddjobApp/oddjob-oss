import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SpatialSurpriseEvaluator");

export interface SpatialPredictionTuple {
    h3Index: string;
    expectedRiskPhi: number; // Predicted risk [0.0 to 1.0]
    confidenceScore: number;
    timeWindowMs: number;
}

export interface SpatialObservationTuple {
    h3Index: string;
    observedRiskPhi: number; // Observed real-time risk [0.0 to 1.0]
    timestamp: string;
}

export interface SpatialSurpriseResult {
    h3Index: string;
    expectedRiskPhi: number;
    observedRiskPhi: number;
    surpriseScoreError: number; // ε = |Phi_obs - Phi_pred|
    isSurpriseThresholdBreached: boolean; // ε > 0.25
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    evaluationTimestamp: string;
    policyOutcome: 'AUTO_APPROVED' | 'HUMAN_GATED' | 'ESCALATED' | 'REJECTED';
}

export interface SpatialPolicyRule {
    ruleId: string;
    name: string;
    enabled: boolean;
    maxRegionalVolatility: number; // [0.0 to 1.0]
    maxSurpriseScore: number;       // Max allowable error ε
    maxRiskPhi: number;             // Cell risk threshold
    restrictedZoneTypes: string[];
    fallbackOutcome: 'HUMAN_GATED' | 'ESCALATED' | 'REJECTED';
}

/**
 * Spatial Surprise Evaluator Service (Phase 2 Specifications):
 * Evaluates real-time observations against stored spatial predictions, calculates error score ε,
 * and executes dynamic policy enforcement gates.
 */
export class SpatialSurpriseEvaluatorService {
    private static DEFAULT_POLICY: SpatialPolicyRule = {
        ruleId: "policy_default_h3_spatial",
        name: "Standard Eulerian Spatial Risk Gate",
        enabled: true,
        maxRegionalVolatility: 0.40,
        maxSurpriseScore: 0.25,
        maxRiskPhi: 0.65,
        restrictedZoneTypes: ["HAZARD_ZONE", "RESTRICTED_AIRSPACE"],
        fallbackOutcome: "HUMAN_GATED"
    };

    /**
     * Evaluates prediction error ε = |Phi_obs - Phi_pred| and checks against dynamic policy thresholds.
     */
    public static evaluateSurprise(
        prediction: SpatialPredictionTuple,
        observation: SpatialObservationTuple,
        customPolicy?: Partial<SpatialPolicyRule>
    ): SpatialSurpriseResult {
        const policy: SpatialPolicyRule = { ...this.DEFAULT_POLICY, ...customPolicy };
        
        // 1. Calculate Spatial Surprise Error Score: ε = |Phi_obs - Phi_pred|
        const surpriseScoreError = Number(
            Math.abs(observation.observedRiskPhi - prediction.expectedRiskPhi).toFixed(3)
        );

        // 2. Threshold Check: ε > 0.25 signifies dynamic spatial surprise
        const isSurpriseThresholdBreached = surpriseScoreError > policy.maxSurpriseScore;

        // 3. Severity Assignment
        let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
        if (surpriseScoreError > 0.50 || observation.observedRiskPhi > 0.85) {
            severity = 'CRITICAL';
        } else if (surpriseScoreError > 0.35 || observation.observedRiskPhi > 0.65) {
            severity = 'HIGH';
        } else if (isSurpriseThresholdBreached) {
            severity = 'MEDIUM';
        }

        // 4. Policy Gate Decision Engine
        let policyOutcome: 'AUTO_APPROVED' | 'HUMAN_GATED' | 'ESCALATED' | 'REJECTED' = 'AUTO_APPROVED';
        if (observation.observedRiskPhi > policy.maxRiskPhi || isSurpriseThresholdBreached) {
            policyOutcome = policy.fallbackOutcome;
        }

        logger.info(
            `[SpatialSurpriseEvaluator] H3 [${prediction.h3Index}] ε = ${surpriseScoreError} (Obs: ${observation.observedRiskPhi}, Pred: ${prediction.expectedRiskPhi}) -> Outcome: ${policyOutcome}`
        );

        return {
            h3Index: prediction.h3Index,
            expectedRiskPhi: prediction.expectedRiskPhi,
            observedRiskPhi: observation.observedRiskPhi,
            surpriseScoreError,
            isSurpriseThresholdBreached,
            severity,
            evaluationTimestamp: new Date().toISOString(),
            policyOutcome
        };
    }
}
