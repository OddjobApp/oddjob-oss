/**
 * Crisis Orchestration Service
 *
 * Automatically detects mission failures in real time and spawns a "Crisis Recovery"
 * sub-mission to triage root cause, attempt repairs, and optionally escalate via HIL.
 *
 * Trigger flow:
 *  missionRun.status → "failed"
 *    → detectCrisis()       — classifies failure type + severity
 *    → spawnRecoveryMission()— launches a new dynamic_autonomous sub-mission focused on fix
 *    → registerCrisisAlert() — writes a HIL approval request + inbox notification
 *
 * Integration:
 *  Call `crisisOrchestrationService.handleMissionFailure()` from the FAIL branch
 *  of dynamic-orchestrator.service.ts and from mission-timeout.service.ts.
 */

import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { missionRuns, missions, jobs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { missionRunService } from "./mission-run.service.js";
import { missionService } from "./mission.service.js";
import { adaptiveLearningService } from "@domain/learning/core/adaptive-learning.service.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { assertOrgId } from "@server/utils/auth-context.js";

const logger = createLogger("CrisisOrchestration");

export type CrisisType =
  | "timeout"
  | "ai_failure"
  | "tool_failure"
  | "budget_exceeded"
  | "consensus_failure"
  | "unknown";

export type CrisisSeverity = "low" | "medium" | "high" | "critical";

export interface CrisisReport {
  missionRunId: number;
  missionId: number;
  crisisType: CrisisType;
  severity: CrisisSeverity;
  errorSummary: string;
  cycleCount: number;
  recoveryMissionRunId?: number;
  escalated: boolean;
  detectedAt: string;
}

export class CrisisOrchestrationService {

  // =========================================================================
  // ENTRY POINT — called on any mission failure
  // =========================================================================

  async handleMissionFailure(
    missionRunId: number,
    orgId: number | null,
    userId: string
  ): Promise<CrisisReport> {
    logger.warn(`[CrisisOrchestration] Handling failure for run ${missionRunId}`);

    // 1. Load run + mission context
    const [data] = await db.select({ run: missionRuns, mission: missions })
      .from(missionRuns)
      .innerJoin(missions, eq(missionRuns.missionId, missions.id))
      .where(eq(missionRuns.id, missionRunId))
      .limit(1);

    if (!data) {
      const fallback: CrisisReport = {
        missionRunId,
        missionId: 0,
        crisisType: "unknown",
        severity: "medium",
        errorSummary: "Run not found",
        cycleCount: 0,
        escalated: false,
        detectedAt: new Date().toISOString(),
      };
      return fallback;
    }

    const { run, mission } = data;
    const ctx = (run.missionContext as Record<string, any>) || {};

    // 2. Classify the crisis
    const crisisType = this.classifyCrisis(ctx);
    const severity = this.assessSeverity(crisisType, ctx);
    const errorSummary = this.extractErrorSummary(ctx);
    const cycleCount = ctx.cycleCount || 0;

    const report: CrisisReport = {
      missionRunId,
      missionId: mission.id,
      crisisType,
      severity,
      errorSummary,
      cycleCount,
      escalated: false,
      detectedAt: new Date().toISOString(),
    };

    logger.warn(`[CrisisOrchestration] Crisis classified: ${crisisType} (${severity}) for run ${missionRunId}`);

    // 3. Record the failure in the adaptive learning system
    try {
      await adaptiveLearningService.recordFailure({
        organizationId: assertOrgId(orgId),
        domain: "mission_execution",
        subcategory: crisisType,
        errorMessage: errorSummary,
        componentName: "dynamic_orchestrator",
        severity: severity === "critical" ? "critical" : severity === "high" ? "high" : "medium",
        context: { missionRunId, missionId: mission.id, cycleCount },
      } as any);
    } catch (learnErr: any) {
      logger.warn(`[CrisisOrchestration] Learning record failed: ${learnErr.message}`);
    }

    // 4. Spawn recovery mission for medium+ severity
    if (severity !== "low") {
      try {
        const recoveryRunId = await this.spawnRecoveryMission(
          mission,
          run,
          crisisType,
          errorSummary,
          orgId,
          userId
        );
        report.recoveryMissionRunId = recoveryRunId;
      } catch (recoveryErr: any) {
        logger.error(`[CrisisOrchestration] Recovery mission spawn failed: ${recoveryErr.message}`);
      }
    }

    // 5. Emit crisis event (picked up by SSE → UI + inbox)
    await eventStream.publish("mission.crisis_detected", {
      ...report,
      missionName: mission.name,
      orgId,
    });

    // 6. Escalate for critical failures
    if (severity === "critical") {
      report.escalated = true;
      await this.escalateCrisis(report, mission, orgId, userId);
    }

    return report;
  }

  // =========================================================================
  // CLASSIFICATION
  // =========================================================================

  private classifyCrisis(ctx: Record<string, any>): CrisisType {
    const lastError: string = ctx.last_error?.message || "";
    const lowerErr = lastError.toLowerCase();

    if (ctx.terminatedDueToTimeout) return "timeout";
    if (lowerErr.includes("quota") || lowerErr.includes("rate limit") || lowerErr.includes("ai")) return "ai_failure";
    if (lowerErr.includes("tool") || lowerErr.includes("mcp") || lowerErr.includes("skill")) return "tool_failure";
    if (lowerErr.includes("budget") || lowerErr.includes("cost")) return "budget_exceeded";
    if (lowerErr.includes("consensus") || lowerErr.includes("swarm")) return "consensus_failure";
    return "unknown";
  }

  private assessSeverity(type: CrisisType, ctx: Record<string, any>): CrisisSeverity {
    const cycleCount = ctx.cycleCount || 0;

    if (type === "ai_failure") return "critical"; // AI being down blocks all missions
    if (type === "budget_exceeded") return "high";
    if (type === "timeout" && cycleCount > 10) return "high";
    if (type === "tool_failure") return "medium";
    if (cycleCount < 2) return "low"; // Failed very early — likely a config issue, not a crisis
    return "medium";
  }

  private extractErrorSummary(ctx: Record<string, any>): string {
    if (ctx.last_error?.message) return String(ctx.last_error.message).slice(0, 300);
    const trace = ctx.dynamicTrace;
    if (Array.isArray(trace)) {
      const lastError = [...trace].reverse().find((t: any) => t.type === "error");
      if (lastError) return String(lastError.error || lastError.note || "").slice(0, 300);
    }
    return "No error details captured.";
  }

  // =========================================================================
  // RECOVERY MISSION
  // =========================================================================

  private async spawnRecoveryMission(
    mission: any,
    failedRun: any,
    crisisType: CrisisType,
    errorSummary: string,
    orgId: number | null,
    userId: string
  ): Promise<number | undefined> {
    logger.info(`[CrisisOrchestration] Spawning recovery mission for ${mission.name}`);

    const recoveryObjective = [
      `CRISIS RECOVERY — Original Mission: "${mission.name}"`,
      `Crisis Type: ${crisisType}`,
      `Error: ${errorSummary}`,
      ``,
      `Your goal is to diagnose and recover from this failure:`,
      `1. Analyze the error and determine root cause`,
      `2. If it's a tool/skill failure: identify an alternative approach`,
      `3. If it's a data issue: search for correct data sources`,
      `4. Propose a concrete fix or retry strategy`,
      `5. If the mission objective can still be met, attempt to complete it`,
    ].join("\n");

    // Create a new mission (sub-mission of the failed one)
    const recoveryMission = await missionService.createMission({
      name: `[CRISIS RECOVERY] ${mission.name}`,
      objective: recoveryObjective,
      organizationId: orgId || undefined,
      createdBy: userId,
      executionStrategy: "dynamic_autonomous",
    } as any, userId, [], false);

    await missionService.updateBlackboard(recoveryMission.id, {
      crisis: {
        originalMissionId: mission.id,
        originalRunId: failedRun.id,
        crisisType,
        errorSummary,
        originalContext: failedRun.missionContext,
      },
      isCrisisRecovery: true,
    }, "system:crisis", "crisis_init");

    // Launch it
    const { dynamicOrchestratorService } = await import("./dynamic-orchestrator.service.js");
    const result = await dynamicOrchestratorService.launchDynamicMission(
      recoveryMission.id,
      userId,
      orgId
    );

    if (result.success && result.missionRunId) {
      logger.info(`[CrisisOrchestration] Recovery mission launched: run ${result.missionRunId}`);
      return result.missionRunId;
    }

    return undefined;
  }

  // =========================================================================
  // ESCALATION
  // =========================================================================

  private async escalateCrisis(
    report: CrisisReport,
    mission: any,
    orgId: number | null,
    userId: string
  ): Promise<void> {
    try {
      const { approvalService } = await import("../../integrations/core/approval.service.js");
      await approvalService.createApprovalRequest({
        executionId: String(report.missionRunId),
        jobId: 1,
        approverType: "user",
        requestType: "crisis_escalation",
        question: [
          `🚨 CRITICAL CRISIS DETECTED`,
          `Mission: ${mission.name}`,
          `Crisis Type: ${report.crisisType.toUpperCase()}`,
          `Error: ${report.errorSummary}`,
          report.recoveryMissionRunId
            ? `A recovery mission (run #${report.recoveryMissionRunId}) has been automatically spawned.`
            : `No recovery could be automatically initiated.`,
          `Please review and decide next steps.`,
        ].join("\n"),
        missionId: report.missionId,
        organizationId: assertOrgId(orgId),
        requestedBy: userId,
        channels: ["inbox", "copilot"],
      } as any);
    } catch (escalateErr: any) {
      logger.error(`[CrisisOrchestration] Escalation failed: ${escalateErr.message}`);
    }
  }

  // =========================================================================
  // REPORTING
  // =========================================================================

  /**
   * Returns recent crisis events for the org (read from failure incidents).
   */
  async getRecentCrises(orgId: number, limit = 20): Promise<any[]> {
    try {
      const { failureIncidents } = await import("@shared/schema/learning/index.js");
      const { desc } = await import("drizzle-orm");
      const { eq: eqFn } = await import("drizzle-orm");

      const incidents = await db.query.failureIncidents.findMany({
        where: eqFn(failureIncidents.organizationId, orgId),
        orderBy: desc(failureIncidents.createdAt),
        limit,
      });

      return incidents;
    } catch (err: any) {
      logger.warn(`[CrisisOrchestration] Failed to fetch recent crises: ${err.message}`);
      return [];
    }
  }
}

export const crisisOrchestrationService = new CrisisOrchestrationService();
