import { createLogger } from "@server/utils/logger.js";
import { LifecycleStage } from "../../agents/core/agent-lifecycle-state-machine.js";
import { PredictionEngine, ModelTier } from "./prediction-engine.service.js";

const logger = createLogger("DynamicTuning");

export interface AgentPerformanceHistory {
    agentId: string;
    consecutiveSuccesses: number;
    consecutiveRetries: number;
    averageLatencyMs: number;
    lastSafeTransitionScore: number;
}

export interface DynamicTuningConfig {
    stage: LifecycleStage;
    targetFileOrNode: string;
    safeTransitionScore: number;
    history: AgentPerformanceHistory;
}

export interface DynamicTuningAdjustment {
    recommendedModelTier: ModelTier;
    adjustedTokenBudget: number;
    requiredSafetyThreshold: number;
    forceSupervisorAttestation: boolean;
    adaptiveReason: string;
}

/**
 * Dynamic Runtime Tuning & Adaptive Calibration Engine:
 * Dynamically tunes model routing tiers, token budget caps, and safety thresholds at runtime
 * based on live agent performance history, trajectory scores, and target node blast radius.
 */
export class DynamicTuningService {
    /**
     * Calculates adaptive runtime adjustments for a given agent execution step.
     */
    public static tuneRuntimeParameters(config: DynamicTuningConfig): DynamicTuningAdjustment {
        const { stage, targetFileOrNode, safeTransitionScore, history } = config;

        // 1. Dynamic Safety Threshold Modulation based on Target Blast Radius
        let requiredSafetyThreshold = 0.85;
        const isProductionTarget = targetFileOrNode.startsWith("prod/") || targetFileOrNode.includes("database/schema");
        const isTestTarget = targetFileOrNode.includes("test") || targetFileOrNode.includes("mock");

        if (isProductionTarget) {
            requiredSafetyThreshold = 0.92; // Stricter threshold for prod
        } else if (isTestTarget) {
            requiredSafetyThreshold = 0.75; // Relaxed threshold for local tests
        }

        // 2. Dynamic Model Tier Selection based on Trajectory Score & History
        let recommendedModelTier: ModelTier = "8b_small";
        let forceSupervisorAttestation = false;

        if (history.consecutiveRetries >= 2) {
            recommendedModelTier = "frontier_large";
            requiredSafetyThreshold = Math.max(requiredSafetyThreshold, 0.95);
            forceSupervisorAttestation = true;
        } else if (safeTransitionScore < 0.60 || history.consecutiveRetries > 0) {
            recommendedModelTier = "frontier_large";
        } else if (safeTransitionScore < requiredSafetyThreshold) {
            recommendedModelTier = "haiku_mid";
        }

        // 3. Adaptive Token Budget Scaling based on Agent Momentum & Latency
        let baseTokenBudget = 300;
        let adaptiveReason = "Standard baseline token budget";

        if (history.consecutiveRetries >= 2) {
            baseTokenBudget = Math.round(baseTokenBudget * 1.5);
            adaptiveReason = `Critical retry rate (${history.consecutiveRetries} retries); escalated to frontier model, safety threshold ${requiredSafetyThreshold}, and forced supervisor attestation.`;
        } else if (history.consecutiveSuccesses >= 3) {
            baseTokenBudget = Math.round(baseTokenBudget * 0.8); // 20% budget reduction for momentum
            adaptiveReason = `High momentum (${history.consecutiveSuccesses} consecutive successes); reduced prompt budget to ${baseTokenBudget}t for speed.`;
        } else if (history.consecutiveRetries >= 1) {
            baseTokenBudget = Math.round(baseTokenBudget * 1.4); // 40% budget expansion to supply deeper context
            adaptiveReason = `Retry detected (${history.consecutiveRetries} retries); expanded prompt budget to ${baseTokenBudget}t to supply deeper 3-hop context.`;
        }

        // Apply latency pressure mitigation if agent response latency is degraded (>5000ms)
        if (history.averageLatencyMs > 5000 && !forceSupervisorAttestation) {
            baseTokenBudget = Math.max(150, Math.round(baseTokenBudget * 0.75));
            adaptiveReason += ` (Latency throttle applied: avg ${history.averageLatencyMs}ms).`;
        }

        logger.info(`[DynamicTuning] Tuned parameters for agent '${history.agentId}'. Tier: ${recommendedModelTier}, Budget: ${baseTokenBudget}t, Safety Threshold: ${requiredSafetyThreshold}, Force Supervisor: ${forceSupervisorAttestation}`);

        return {
            recommendedModelTier,
            adjustedTokenBudget: baseTokenBudget,
            requiredSafetyThreshold,
            forceSupervisorAttestation,
            adaptiveReason
        };
    }
}
