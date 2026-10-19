// ============================================================================
// PREDICTION INTELLIGENCE DOMAIN — PREDICTION POD
// HIL Predictor — Predicts if a mission will require Human-In-The-Loop input
// ============================================================================

import { randomUUID } from "crypto";
import { createLogger } from "@server/utils/logger.js";
import type { DomainContext } from "../quant/types.js";

const logger = createLogger("HilPredictor");

export interface HilPredictionResult {
    id: string;
    missionRunId: number;
    requiresHil: boolean;
    confidence: number;
    reason: string;
    predictedFormName?: string;
    suggestedFields?: string[];
    createdAt: string;
}

export class HilPredictor {
    /**
     * Predicts if a mission run will require HIL based on its plan and parameters.
     */
    async predictHilRequirement(
        missionRunId: number,
        plan: { steps: { action: string, risk?: string }[] },
        ctx: DomainContext
    ): Promise<HilPredictionResult> {
        logger.info(`[HilPredictor] Analyzing mission ${missionRunId} for HIL requirements`);

        let requiresHil = false;
        let confidence = 0.5;
        let reason = "No specific triggers found";
        let predictedFormName: string | undefined;
        let suggestedFields: string[] | undefined;

        // Heuristics based on action names and risk
        const steps = plan.steps || [];
        
        for (const step of steps) {
            const action = step.action.toLowerCase();
            
            if (action.includes("deploy") || action.includes("publish")) {
                requiresHil = true;
                confidence = 0.9;
                reason = `Step involves high-risk action: ${step.action}`;
                predictedFormName = "deployment_approval";
                suggestedFields = ["target_environment", "approval_reason"];
                break;
            }
            
            if (action.includes("delete") || action.includes("remove")) {
                requiresHil = true;
                confidence = 0.95;
                reason = `Step involves destructive action: ${step.action}`;
                predictedFormName = "destructive_action_approval";
                suggestedFields = ["confirm_deletion", "justification"];
                break;
            }

            if (step.risk === "high" || step.risk === "critical") {
                requiresHil = true;
                confidence = 0.85;
                reason = `Step marked as high risk: ${step.action}`;
                predictedFormName = "high_risk_operation_approval";
                suggestedFields = ["risk_mitigation_plan"];
                break;
            }
        }

        const result: HilPredictionResult = {
            id: randomUUID(),
            missionRunId,
            requiresHil,
            confidence,
            reason,
            predictedFormName,
            suggestedFields,
            createdAt: new Date().toISOString()
        };

        logger.info(`[HilPredictor] Prediction for ${missionRunId}: requiresHil=${requiresHil}, confidence=${confidence}`);
        return result;
    }
}

export const hilPredictor = new HilPredictor();
