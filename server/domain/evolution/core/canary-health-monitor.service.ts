/**
 * Canary Health Monitor & Automated Rollback Service
 * ===================================================
 * Evaluates live telemetry metrics for canary phenotypes and triggers
 * automated zero-downtime rollbacks when error thresholds or latency SLOs are breached.
 */

import { createLogger } from "@server/utils/logger.js";
import {
  evolutionLifecycleService,
  EvolutionLifecycleService,
} from "./evolution-lifecycle.service.js";
import type { PhenotypeStage } from "@shared/evo-devo/index.js";

const logger = createLogger("CanaryHealthMonitor");

export interface CanaryMetrics {
  totalObservations: number;
  errorCount: number;
  p99LatencyMs: number;
  sloBreachCount: number;
}

export interface CanaryHealthEvaluation {
  healthy: boolean;
  errorRate: number;
  shouldRollback: boolean;
  readyForPromotion: boolean;
  reason: string;
}

export interface CanaryEnforcementResult {
  actionTaken: "none" | "rollback" | "promotion_ready";
  currentStage: PhenotypeStage;
  targetStage?: PhenotypeStage;
  reason: string;
  eventId?: string;
}

export class CanaryHealthMonitorService {
  private readonly maxErrorRateThreshold = 0.05; // 5% error rate circuit breaker
  private readonly maxLatencyThresholdMs = 1500; // 1.5s p99 latency SLO
  private readonly minObservationsForPromotion = 100;

  /**
   * Evaluates live metrics against canary SLOs
   */
  evaluateCanaryHealth(metrics: CanaryMetrics): CanaryHealthEvaluation {
    if (metrics.totalObservations === 0) {
      return {
        healthy: true,
        errorRate: 0,
        shouldRollback: false,
        readyForPromotion: false,
        reason: "No observations recorded yet.",
      };
    }

    const errorRate = metrics.errorCount / metrics.totalObservations;
    const isErrorBreach = errorRate > this.maxErrorRateThreshold;
    const isLatencyBreach = metrics.p99LatencyMs > this.maxLatencyThresholdMs;

    if (isErrorBreach || isLatencyBreach) {
      const reason = isErrorBreach
        ? `Canary error rate ${(errorRate * 100).toFixed(1)}% exceeded maximum threshold of ${(this.maxErrorRateThreshold * 100)}%`
        : `Canary p99 latency ${metrics.p99LatencyMs}ms exceeded threshold of ${this.maxLatencyThresholdMs}ms`;

      return {
        healthy: false,
        errorRate,
        shouldRollback: true,
        readyForPromotion: false,
        reason,
      };
    }

    const readyForPromotion =
      metrics.totalObservations >= this.minObservationsForPromotion &&
      metrics.errorCount === 0;

    return {
      healthy: true,
      errorRate,
      shouldRollback: false,
      readyForPromotion,
      reason: readyForPromotion
        ? `Canary verified healthy across ${metrics.totalObservations} observations with 0 errors.`
        : `Canary currently healthy across ${metrics.totalObservations} observations.`,
    };
  }

  /**
   * Evaluates canary metrics and automatically executes rollback if SLOs are violated
   */
  async enforceCanaryGate(
    organizationId: number,
    phenotypeId: string,
    metrics: CanaryMetrics,
    lifecycle: EvolutionLifecycleService = evolutionLifecycleService,
    actorId = "canary-health-monitor",
  ): Promise<CanaryEnforcementResult> {
    const stageInfo = await lifecycle.getCurrentStage(organizationId, phenotypeId);
    if (stageInfo.stage !== "canary") {
      return {
        actionTaken: "none",
        currentStage: stageInfo.stage,
        reason: `Phenotype is in '${stageInfo.stage}' stage, not 'canary'.`,
      };
    }

    const evaluation = this.evaluateCanaryHealth(metrics);

    if (evaluation.shouldRollback) {
      logger.warn(
        `[CanaryHealthMonitor] Triggering automated rollback for phenotype ${phenotypeId}: ${evaluation.reason}`,
      );

      const transition = await lifecycle.transition(
        organizationId,
        phenotypeId,
        {
          action: "rollback",
          evidence: {
            rollbackTarget: "shadow",
            reason: `Automated Canary Rollback: ${evaluation.reason}`,
          },
        },
        actorId,
      );

      return {
        actionTaken: "rollback",
        currentStage: "canary",
        targetStage: transition.to,
        reason: evaluation.reason,
        eventId: transition.eventId,
      };
    }

    if (evaluation.readyForPromotion) {
      return {
        actionTaken: "promotion_ready",
        currentStage: "canary",
        reason: evaluation.reason,
      };
    }

    return {
      actionTaken: "none",
      currentStage: "canary",
      reason: evaluation.reason,
    };
  }
}

export const canaryHealthMonitorService = new CanaryHealthMonitorService();
