/**
 * Mission Service
 *
 * Manages durable mission state (Blackboard as State Machine).
 * missionRuns track pipeline sequences, checkpoints, and resume conditions.
 * Aligned with docs/specs/MISSIONS_SPEC.md
 */

import { db } from "@server/database_service.js";
import {
  missions,
  missionRuns,
  missionShadowRuns,
  missionTemplates,
  missionStepAssignments,
  missionBlackboardHistory,
  missionMembers,
  missionDeliverables,
  pipelineExecutions,
  pipelineSteps,
  pipelineStepExecutions,
  jobs,
  hilForms,
  approvalRequests,
  agentDeployments,
  cycleRunEvents,
  type ResumeCondition,
  type MissionRun,
  type MissionRunStatus,
  type MissionShadowRun,
  type MissionTemplate,
} from "@shared/schema/index.js";

import { SupervisorPlanSchema, type SupervisorPlan } from "@shared/schema/supervisor.js";
import { agentRunSteps } from "@shared/schema/agent/chat.js";
import { pipelines } from "@shared/schema/pipelines/pipeline-core.js";
import { eq, and, desc, asc, inArray, sql, or, gte, isNull, isNotNull } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { NotFoundError } from "@server/utils/errors.js";
import { queueService, QUEUE_NAMES } from "@domain/core/infrastructure/queue/queue-service.js";
import { missionCorrelationService, correlatedLog } from "./mission-correlation.service.js";
import { missionQueryService } from "./mission-query.service.js";
import { missionResumptionService } from "./mission-resumption.service.js";
import { missionTimelineService, TimelineItem } from "./mission-timeline.service.js";
import { xrayEventBus, XrayEventType } from "@domain/xray/core/xray-event-bus.js";

const logger = createLogger("MissionRunService");

export interface CreateMissionRunRunInput {
  missionId: number;
  organizationId?: number;
  name: string;
  pipelineSequence: number[];
  createdBy: string;
  currentPipelineId?: number;
  parentId?: number;
  reasoningProtocol?: string;
  isShadow?: boolean;
  missionContext?: Record<string, any>;
}

export interface CheckpointInput {
  missionRunId: number;
  missionContext: Record<string, unknown>;
  reason: string;
  changedBy: string;
  missionId: number;
  status?: MissionRunStatus;
  isSuccess?: boolean;
  actualMetricValue?: number;
  metricType?: string;
}

export const missionRunService = {
    /** Ontology action log rows for a run's evidence bundle, org-filtered when known. */
    async listOntologyActionLog(missionRunId: number, organizationId?: number | null) {
        const { ontologyActionLog, ontologyActions } = await import("@shared/schema/index.js");
        return await db
            .select({ log: ontologyActionLog, action: ontologyActions })
            .from(ontologyActionLog)
            .leftJoin(ontologyActions, eq(ontologyActionLog.actionId, ontologyActions.id))
            .where(and(
                eq(ontologyActionLog.missionRunId, missionRunId),
                ...(organizationId ? [eq(ontologyActionLog.organizationId, organizationId)] : []),
            ));
    },

    /** Shadow runs spawned from a parent run, newest first. */
    async listShadowRuns(parentRunId: number) {
        const { missionShadowRuns } = await import("@shared/schema/index.js");
        return await db
            .select()
            .from(missionShadowRuns)
            .where(eq(missionShadowRuns.parentRunId, parentRunId))
            .orderBy(desc(missionShadowRuns.createdAt));
    },

    /**
     * Recent failed skill executions from the forensic log.
     *
     * NOTE: intentionally unchanged from the route version, which carries no org
     * filter — the forensic log is queried globally here. Worth revisiting.
     */
    async listSkillFailureEvents(limit = 20) {
        const { forensicEventLog } = await import("@shared/schema/index.js");
        return await db
            .select()
            .from(forensicEventLog)
            .where(and(
                eq(forensicEventLog.jobType, "uci_skill_execution"),
                eq(forensicEventLog.status, "failure"),
            ))
            .orderBy(desc(forensicEventLog.createdAt))
            .limit(limit);
    },

    /** Optimization approval requests tied to the given shadow-run execution ids. */
    async listOptimizationProposals(executionIds: string[]) {
        if (executionIds.length === 0) return [];
        const { approvalRequests } = await import("@shared/schema/index.js");
        return await db
            .select()
            .from(approvalRequests)
            .where(or(...executionIds.map((eid) => eq(approvalRequests.executionId, eid))))
            .orderBy(desc(approvalRequests.createdAt));
    },

  /**
   * Create a new mission.
   */
  async create(input: CreateMissionRunRunInput): Promise<MissionRun> {
    const [firstPipelineId] = input.pipelineSequence;
    
    // Initialize correlation context for this mission run
    const correlationContext = missionCorrelationService.initializeMissionContext(
      input.missionId,
      0, // Will be updated after creation
      undefined // Could pass parent correlation here if available in the future
    );
    
    const [run] = await db
      .insert(missionRuns)
      .values({
        missionId: input.missionId,
        organizationId: input.organizationId ?? null,
        name: input.name,
        status: "active",
        pipelineSequence: input.pipelineSequence,
        currentPipelineId: input.currentPipelineId ?? firstPipelineId ?? null,
        currentStepIndex: 0,
        missionContext: {
          ...(input.missionContext || {}),
          _correlation: {
            correlationId: correlationContext.correlationId,
            startedAt: correlationContext.startedAt.toISOString(),
          },
        },
        createdBy: input.createdBy,
        parentId: input.parentId ?? null,
        reasoningProtocol: input.reasoningProtocol || "json_manifest",
        isShadow: input.isShadow || false,
      })
      .returning();

    if (!run) throw new Error("Failed to create mission");
    
    // Update correlation context with actual run ID
    correlationContext.missionRunId = run.id;
    
    correlatedLog.info("MissionRunService", `Created mission run ${run.id}`, {
      missionId: input.missionId,
      correlationId: correlationContext.correlationId,
      parentId: input.parentId,
    });

    // Notify X-Ray if pipeline links exist
    if (run.currentPipelineId) {
        xrayEventBus.emitEvent({
            type: XrayEventType.RELATIONSHIP_UPDATED,
            orgId: run.organizationId,
            entityType: 'mission_run',
            entityId: run.id
        });
    }
    
    return run;
  },

  /**
   * Get mission by ID with pipeline execution ETC.
   */
  async getById(missionRunId: number, organizationId?: number): Promise<MissionRun | null> {
    return missionQueryService.getById(missionRunId, organizationId);
  },

  /**
   * Get mission or throw.
   */
  async getByIdOrThrow(missionRunId: number, organizationId?: number): Promise<MissionRun> {
    const mission = await this.getById(missionRunId, organizationId);
    if (!mission) throw new NotFoundError("Mission Run not found");
    return mission;
  },

  /**
   * List missionRuns by missionId or organization with pipeline ETC.
   */
  async list(options: {
    missionId?: number;
    organizationId?: number;
    status?: MissionRunStatus;
    statuses?: MissionRunStatus[];
  }): Promise<Array<MissionRun & { estimatedTimeRemainingMs?: number | null }>> {
    const conditions = [isNull(missionRuns.deletedAt)];
    if (options.missionId != null) {
      conditions.push(eq(missionRuns.missionId, options.missionId));
    }
    if (options.organizationId != null) {
      conditions.push(eq(missionRuns.organizationId, options.organizationId));
    }
    if (options.status) {
      conditions.push(eq(missionRuns.status, options.status));
    } else if (options.statuses) {
      conditions.push(inArray(missionRuns.status, options.statuses));
    }

    const rows = await db
      .select({
        mission: missionRuns,
        etc: pipelineExecutions.estimatedTimeRemainingMs
      })
      .from(missionRuns)
      .leftJoin(pipelineExecutions, eq(missionRuns.pipelineExecutionId, pipelineExecutions.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(missionRuns.updatedAt));

    // Synthesize phases for the list view
    return Promise.all(rows.map(async r => {
      const phase = await this.synthesizePhase(r.mission);
      return { 
        ...r.mission, 
        phase,
        estimatedTimeRemainingMs: r.etc 
      };
    }));
  },

  /**
   * Get mission runs for a set of cycle IDs.
   * Used by X-Ray for cross-domain mapping.
   */
  async getRunsForCycles(cycleIds: number[]): Promise<Array<{ missionId: number | null; cycleId: number | null }>> {
    if (cycleIds.length === 0) return [];
    return await db.select({ missionId: missionRuns.missionId, cycleId: missionRuns.cycleId })
      .from(missionRuns)
      .where(and(inArray(missionRuns.cycleId, cycleIds), isNull(missionRuns.deletedAt)));
  },

  /**
   * Helper to synthesize phase from mission state and executions.
   */
  async synthesizePhase(mission: MissionRun, executions?: any[]): Promise<string> {
    return missionQueryService.synthesizePhase(mission, executions);
  },

  /**
   * Checkpoint mission: merge state, write to blackboard history, update mission.
   */
  async checkpoint(input: CheckpointInput, tx?: any): Promise<void> {
    const correlationId = missionCorrelationService.getCorrelationId();
    correlatedLog.info("MissionRunService", `Checkpointing mission run ${input.missionRunId}`, {
      missionId: input.missionId,
      reason: input.reason,
      changedBy: input.changedBy,
    });
    
    const dbClient = tx || db;
    
    // Use a simple query to avoid recursion with getById -> getTimeline -> checkpoint
    const [mission] = await dbClient
      .select()
      .from(missionRuns)
      .where(eq(missionRuns.id, input.missionRunId))
      .limit(1);
      
    if (!mission) throw new NotFoundError("Mission Run not found during checkpoint");

    const mergedContext = { 
      ...(mission.missionContext as Record<string, unknown>), 
      ...input.missionContext,
      _checkpoint: {
        checkpointedAt: new Date().toISOString(),
        reason: input.reason,
        changedBy: input.changedBy,
        correlationId,
      }
    };

    await dbClient
      .update(missionRuns)
      .set({
        missionContext: mergedContext,
        lastCheckpointAt: new Date(),
        updatedAt: new Date(),
        ...(input.status ? { status: input.status } : {}),
        ...(input.isSuccess !== undefined ? { isSuccess: input.isSuccess } : {}),
        ...(input.actualMetricValue !== undefined ? { actualMetricValue: input.actualMetricValue.toString() } : {}),
        ...(input.metricType ? { metricType: input.metricType } : {}),
      })
      .where(eq(missionRuns.id, input.missionRunId));

    await dbClient.insert(missionBlackboardHistory).values({
      missionId: input.missionId,
      missionRunId: input.missionRunId,
      blackboard: mergedContext,
      changedBy: input.changedBy,
      changeReason: input.reason,
    });

    // 2. Sync result back to the root mission blackboard for visibility (Asynchronously via QMD)
    const { missionService } = await import("./mission.service.js");
    await missionService.queueBlackboardUpdate(input.missionId, mergedContext, input.changedBy, input.reason);

    correlatedLog.info("MissionRunService", `Checkpoint COMPLETE for mission run ${input.missionRunId}`, {
      missionId: input.missionId,
      correlationId,
    });
  },

  /**
   * Pause mission waiting for a file.
   */
  async pauseForFile(
    missionRunId: number,
    folderPath: string,
    filePattern: string,
    pipelineExecutionId: number,
    stepId: number
  ): Promise<void> {
    return missionResumptionService.pauseForFile(missionRunId, folderPath, filePattern, pipelineExecutionId, stepId);
  },

  /**
   * Pause mission waiting for human approval.
   */
  async pauseForHumanApproval(
    missionRunId: number,
    approvalRequestIds: number[],
    selectionList?: any[]
  ): Promise<void> {
    return missionResumptionService.pauseForHumanApproval(missionRunId, approvalRequestIds, selectionList);
  },

  /**
   * Manual resume of a mission run.
   */
  async resume(id: number): Promise<void> {
    await db.update(missionRuns)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(missionRuns.id, id));
    logger.info(`MissionRun ${id} manually resumed`);
  },

  /**
   * Heartbeat to prevent mission from being reaped as stale.
   */
  async heartbeat(missionRunId: number): Promise<void> {
    await db.update(missionRuns)
      .set({ updatedAt: new Date() })
      .where(eq(missionRuns.id, missionRunId));
  },

  /**
   * Resume mission (file wake-up): re-run the folder_import step with matched file.
   */
  async resumeMissionRun(missionRunId: number, matchedFilePath?: string): Promise<void> {
    return missionResumptionService.resumeMissionRun(missionRunId, matchedFilePath);
  },

  /**
   * Called when an approval is resolved; updates mission state only.
   * Pipeline resume is handled by existing HIL flow.
   */
  async resumeIfWaitingOnApproval(approvalRequestId: number): Promise<void> {
    // Uses GIN index idx_mission_runs_resume_approval_ids (Migration 013)
    const allWaiting = await db.select().from(missionRuns)
      .where(eq(missionRuns.status, "waiting_on_human"))
      .limit(500);
    const matching = allWaiting.filter((m) => {
      const ids = (m.resumeCondition as ResumeCondition)?.approvalRequestIds ?? [];
      return ids.some(id => Number(id) === Number(approvalRequestId));
    });

    for (const m of matching) {
      await this.resumeMissionRun(m.id);
      logger.info(`MissionRun ${m.id} resumed from waiting_on_human (approval ${approvalRequestId} resolved)`);
    }
  },

  /**
   * Resume mission run by step execution ID (called by HIL submission).
   */
  async resumeByStepExecutionId(stepExecutionId: number | null | undefined, responses?: any): Promise<void> {
    if (stepExecutionId == null) {
      logger.debug(`No stepExecutionId provided for HIL resume, skipping`);
      return;
    }

    const [stepExec] = await db.select()
      .from(pipelineStepExecutions)
      .where(eq(pipelineStepExecutions.id, stepExecutionId))
      .limit(1);

    if (!stepExec) {
      logger.warn(`Step execution ${stepExecutionId} not found during HIL resume`);
      return;
    }

    // Find the mission run linked to this pipeline execution
    const [run] = await db.select()
      .from(missionRuns)
      .where(eq(missionRuns.pipelineExecutionId, stepExec.pipelineExecutionId))
      .limit(1);

    if (run) {
      logger.info(`Resuming mission run ${run.id} via step ${stepExecutionId} completion`);
      await this.clearResumeAndSetActive(run.id);

      if (responses) {
        // Log the HIL interaction in the mission timeline
        await this.checkpoint({
          missionRunId: run.id,
          missionId: run.missionId!,
          missionContext: {
            hil_responses: responses
          },
          reason: "checkpoint:hil_submission",
          changedBy: "system"
        });
      }
    } else {
      logger.debug(`No mission run found for pipeline execution ${stepExec.pipelineExecutionId}`);
    }
  },

  /**
   * Clear resume condition and set status to active.
   */
  async clearResumeAndSetActive(missionRunId: number): Promise<void> {
    await db
      .update(missionRuns)
      .set({
        status: "active",
        resumeCondition: null,
        updatedAt: new Date(),
      })
      .where(eq(missionRuns.id, missionRunId));
  },

  /**
   * Update mission (e.g. missionContext, pipelineSequence).
   */
  async update(missionRunId: number, update: Partial<Pick<MissionRun, "missionContext" | "status" | "currentPipelineId" | "currentStepIndex" | "pipelineSequence" | "pipelineExecutionId" | "dynamicTrace" | "isSuccess" | "failureReason" | "actualMetricValue" | "metricType">>): Promise<MissionRun> {
    const [mission] = await db
      .update(missionRuns)
      .set({ ...update, updatedAt: new Date() })
      .where(eq(missionRuns.id, missionRunId))
      .returning();

    if (!mission) throw new NotFoundError("Mission Run not found");

    // Notify X-Ray if relationship-impacting fields changed
    if (update.currentPipelineId) {
        xrayEventBus.emitEvent({
            type: XrayEventType.RELATIONSHIP_UPDATED,
            orgId: mission.organizationId,
            entityType: 'mission_run',
            entityId: mission.id
        });
    }

    // --- TERMINAL STATUS HOOKS: TRUSTGRAPH & SOUL EVOLUTION ---
    if (update.status === "completed" || update.status === "failed") {
      const { MissionLifecycleHooks } = await import("./mission-lifecycle-hooks.js");
      await MissionLifecycleHooks.onMissionTerminalState(
        missionRunId, 
        update.status, 
        update.failureReason || (mission.missionContext as any)?.last_error?.message
      );

      // Schedule Forensic Audit
      queueService.addJobWithTrace(queueService.auditQueue, "forensic-audit", { missionRunId }).catch((err: any) => {
        logger.warn(`Failed to schedule audit for mission ${missionRunId}: ${err.message}`);
      });

      // Emit terminal event for bridge notification
      const { missionEventBus, MissionEvent } = await import("./mission-event-bus.js");
      missionEventBus.emit(
        update.status === 'completed' ? MissionEvent.COMPLETED : MissionEvent.FAILED,
        { missionRunId, status: update.status } as any
      );
    }

    // Copilot research missions deliver their answer as soon as it's ready. The dynamic
    // orchestrator's agent-driven conclusion sets a result but parks the run in
    // "waiting_on_human" (not a terminal state), so onMissionTerminalState above never
    // sees it. Fire the research completion here too; it is idempotent (guards on
    // copilotResearchDelivered), so a later "completed" transition won't double-post.
    if (update.status === "waiting_on_human") {
      const ctx = (mission.missionContext as any) || {};
      if (ctx.source === "copilot_research" && ctx.result && !ctx.copilotResearchDelivered) {
        const { MissionLifecycleHooks } = await import("./mission-lifecycle-hooks.js");
        (MissionLifecycleHooks as any).runCopilotResearchCompletion(mission, "completed");
        await db.update(missionRuns)
          .set({ missionContext: { ...ctx, copilotResearchDelivered: true }, updatedAt: new Date() })
          .where(eq(missionRuns.id, missionRunId));
      }
    }

    return mission;
  },

  /**
   * Delete a mission by ID.
   */
  async delete(missionRunId: number, organizationId?: number): Promise<void> {
    const conditions = [eq(missionRuns.id, missionRunId)];
    if (organizationId != null) {
      conditions.push(eq(missionRuns.organizationId, organizationId));
    }
    const [deleted] = await db.update(missionRuns)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
      
    if (!deleted) throw new NotFoundError("MissionRun not found or unauthorized");
    logger.info(`Soft deleted mission run ${missionRunId}`);
  },

  /**
   * Bulk delete missionRuns by IDs.
   */
  async bulkDelete(missionIds: number[], organizationId?: number): Promise<number> {
    if (missionIds.length === 0) return 0;
    
    let totalDeleted = 0;
    const chunkSize = 500;
    
    for (let i = 0; i < missionIds.length; i += chunkSize) {
      const chunk = missionIds.slice(i, i + chunkSize);
      const conditions = [inArray(missionRuns.id, chunk)];
      if (organizationId != null) {
        conditions.push(eq(missionRuns.organizationId, organizationId));
      }
      const deleted = await db.update(missionRuns)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(...conditions))
        .returning();
        
      totalDeleted += deleted.length;
    }
    
    logger.info(`Bulk soft-deleted ${totalDeleted} missionRuns`);
    return totalDeleted;
  },

  /**
   * Manual resume (clear resume condition, set active).
   */
  async manualResume(missionRunId: number): Promise<void> {
    await this.resumeMissionRun(missionRunId);
  },

  /**
   * Get reasoning feed (from missionBlackboardHistory with changeReason like "reasoning:*" or "thought:*").
   */
  async getReasoningFeed(missionRunId: number, limit = 100): Promise<Array<{ text: string; changedBy: string; createdAt: Date }>> {
    const mission = await this.getByIdOrThrow(missionRunId);
    return missionTimelineService.getReasoningFeed(missionRunId, mission.missionId!, mission.dynamicTrace as any[], limit);
  },

  /**
   * Get checkpoints for timeline (from missionBlackboardHistory with changeReason like "checkpoint:*").
   */
  async getCheckpoints(missionRunId: number, limit = 50, missionId?: number): Promise<Array<{ blackboard: unknown; changeReason: string | null; createdAt: Date }>> {
    return missionTimelineService.getCheckpoints(missionRunId, limit, missionId);
  },

  /**
   * Get combined timeline: checkpoints + approval events for Decision Timeline.
   * Merges missionBlackboardHistory (checkpoint:*) with approvalRequests for this mission.
   */
  async getTimeline(missionRunId: number, limit = 50, missionObj?: any): Promise<TimelineItem[]> {
    return missionTimelineService.getTimeline(missionRunId, limit, missionObj);
  },

  /**
   * List missionRuns waiting on file (for folder_import wake-up).
   */
  async listWaitingOnFile(): Promise<MissionRun[]> {
    const rows = await db.select().from(missionRuns).where(and(
      eq(missionRuns.status, "waiting_on_file"),
      isNull(missionRuns.deletedAt)
    ));
    return rows.filter((m) => (m.resumeCondition as ResumeCondition)?.type === "file");
  },

  /**
   * Create assignment for local runner (when folder_import step + mission context).
   */
  async createAssignment(input: {
    missionRunId: number;
    pipelineExecutionId: number;
    pipelineStepId: number;
    organizationId?: number | null;
    jobType: string;
    jobConfig?: Record<string, unknown>;
  }) {
    const [assignment] = await db
      .insert(missionStepAssignments)
      .values({
        missionRunId: input.missionRunId,
        pipelineExecutionId: input.pipelineExecutionId,
        pipelineStepId: input.pipelineStepId,
        organizationId: input.organizationId ?? null,
        status: "pending",
        jobType: input.jobType,
        jobConfig: input.jobConfig ?? null,
      })
      .returning();
    if (!assignment) throw new Error("Failed to create assignment");
    logger.info(`Created assignment ${assignment.id} for mission run ${input.missionRunId} step ${input.pipelineStepId}`);
    return assignment;
  },

  /**
   * Claim pending assignments for a mission (local runner).
   */
  async claimAssignments(missionRunId: number, claimedBy: string, organizationId: number) {
    const [assignment] = await db
      .select()
      .from(missionStepAssignments)
      .where(
        and(
          eq(missionStepAssignments.missionRunId, missionRunId),
          eq(missionStepAssignments.status, "pending"),
          eq(missionStepAssignments.organizationId, organizationId)
        )
      )
      .limit(1);
    if (!assignment) return null;
    const [updated] = await db
      .update(missionStepAssignments)
      .set({
        status: "claimed",
        claimedBy,
        claimedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(missionStepAssignments.id, assignment.id))
      .returning();
    return updated ?? null;
  },

  /**
   * List pending assignments for organization (local runner polls).
   */
  async listPendingAssignments(organizationId: number) {
    return db
      .select()
      .from(missionStepAssignments)
      .where(
        and(
          eq(missionStepAssignments.organizationId, organizationId),
          eq(missionStepAssignments.status, "pending")
        )
      )
      .orderBy(asc(missionStepAssignments.createdAt));
  },

  /**
   * Complete assignment (local runner reports result).
   * Resumes pipeline execution with the result when assignment is completed.
   */
  async completeAssignment(
    assignmentId: number,
    result: { success: boolean; output: string; error?: string },
    organizationId: number
  ) {
    const [assignment] = await db
      .select()
      .from(missionStepAssignments)
      .where(
        and(
          eq(missionStepAssignments.id, assignmentId),
          eq(missionStepAssignments.organizationId, organizationId)
        )
      )
      .limit(1);
    if (!assignment) return null;
    const [updated] = await db
      .update(missionStepAssignments)
      .set({
        status: result.success ? "completed" : "failed",
        completedAt: new Date(),
        result: result as any,
        updatedAt: new Date(),
      })
      .where(eq(missionStepAssignments.id, assignmentId))
      .returning();
    if (updated && result.success) {
      try {
        const [stepExec] = await db
          .select()
          .from(pipelineStepExecutions)
          .where(
            and(
              eq(pipelineStepExecutions.pipelineExecutionId, assignment.pipelineExecutionId),
              eq(pipelineStepExecutions.pipelineStepId, assignment.pipelineStepId)
            )
          )
          .orderBy(desc(pipelineStepExecutions.id))
          .limit(1);
        if (stepExec) {
          await db
            .update(pipelineStepExecutions)
            .set({
              output: result.output,
              status: "success",
              completedAt: new Date(),
            })
            .where(eq(pipelineStepExecutions.id, stepExec.id));
        }
        const { pipelineExecutor } = await import("../../../core/pipeline-executor.js");
        await pipelineExecutor.resumePipelineExecution(
          assignment.pipelineExecutionId,
          undefined,
          undefined
        );
        logger.info(`Resumed pipeline ${assignment.pipelineExecutionId} after local runner completed assignment ${assignmentId}`);
      } catch (resumeErr) {
        logger.error(`Failed to resume pipeline after assignment ${assignmentId}:`, resumeErr);
      }
    }
    return updated ?? null;
  },

  /**
   * Check if org has local runner token (runnerScope: "local").
   */
  async hasLocalRunner(organizationId: number): Promise<boolean> {
    const { mcpApiTokens } = await import("@shared/schema/index.js");
    const [found] = await db
      .select({ id: mcpApiTokens.id })
      .from(mcpApiTokens)
      .where(
        and(
          eq(mcpApiTokens.organizationId, organizationId),
          eq(mcpApiTokens.isActive, true),
          sql`(${mcpApiTokens.metadata}->>'runnerScope') = 'local'`
        )
      )
      .limit(1);
    return !!found;
  },

  /**
   * Pause mission run.
   */
  async pause(missionRunId: number): Promise<void> {
    await db
      .update(missionRuns)
      .set({
        status: "paused",
        updatedAt: new Date(),
      })
      .where(eq(missionRuns.id, missionRunId));
    logger.info(`MissionRun ${missionRunId} manually paused.`);
  },

  /**
   * Terminate mission run.
   */
  async terminate(missionRunId: number, userId: string): Promise<void> {
    const mission = await this.getByIdOrThrow(missionRunId);

    await db
      .update(missionRuns)
      .set({
        status: "failed",
        updatedAt: new Date(),
      })
      .where(eq(missionRuns.id, missionRunId));

    // Abort the linked pipeline execution if one is running
    if (mission.pipelineExecutionId) {
      try {
        const { pipelineExecutor } = await import("@server/core/pipeline-executor.js");
        pipelineExecutor.abortExecution(mission.pipelineExecutionId);
        logger.info(`Abort signal sent for pipeline execution ${mission.pipelineExecutionId}`);
      } catch (abortErr: any) {
        logger.warn(`Failed to abort pipeline execution ${mission.pipelineExecutionId}: ${abortErr.message}`);
      }
    }

    // Cancel any queued dynamic mission cycles
    try {
      const { cancelMissionWave } = await import("../infrastructure/rolling-wave-queue.js");
      await cancelMissionWave(missionRunId);
    } catch { /* rolling wave queue may not be relevant */ }

    // Create a checkpoint for termination trace
    await this.checkpoint({
      missionRunId,
      missionId: mission.missionId!,
      missionContext: { ...((mission.missionContext as any) || {}), terminationReason: "manual_stop" },
      reason: "manual_termination",
      changedBy: userId
    });

    logger.info(`MissionRun ${missionRunId} manually terminated by ${userId}.`);
  },

  /**
   * Get aggregated stats for the mission dashboard.
   */
  async getMissionDashboardStats(organizationId: number): Promise<any[]> {
    const result = await db
      .select({
        missionId: missionRuns.missionId,
        totalRuns: sql<number>`count(${missionRuns.id})`,
        successfulRuns: sql<number>`count(case when ${missionRuns.status} = 'completed' then 1 end)`,
        averageDurationMs: sql<number>`avg(case when ${missionRuns.status} = 'completed' then extract(epoch from ${missionRuns.updatedAt} - ${missionRuns.createdAt}) * 1000 else null end)`,
        missionName: missions.name,
      })
      .from(missionRuns)
      .leftJoin(missions, eq(missionRuns.missionId, missions.id))
      .where(eq(missionRuns.organizationId, organizationId))
      .groupBy(missionRuns.missionId, missions.name);

    return result;
  },

  /**
   * Get aggregated stats for the agent dashboard.
   */
  async getAgentDashboardStats(organizationId: number): Promise<any[]> {
    const { cycleRunEvents } = await import("@shared/schema/cycle-run-events.js");
    const { jobs } = await import("@shared/schema/jobs/index.js");

    const agentEvents = await db
      .select({
        agentId: cycleRunEvents.agentId,
        eventType: cycleRunEvents.eventType,
        durationMs: cycleRunEvents.durationMs,
      })
      .from(cycleRunEvents)
      .leftJoin(jobs, eq(cycleRunEvents.jobId, jobs.id))
      .where(and(
        eq(jobs.organizationId, organizationId),
        isNotNull(cycleRunEvents.agentId),
        or(eq(cycleRunEvents.eventType, 'STEP_COMPLETED'), eq(cycleRunEvents.eventType, 'STEP_FAILED'))
      ));

    const statsByAgent: Record<string, { totalRuns: number; successfulRuns: number; totalDuration: number; }> = {};

    for (const event of agentEvents) {
        if (!event.agentId) continue;

        if (!statsByAgent[event.agentId]) {
            statsByAgent[event.agentId] = { totalRuns: 0, successfulRuns: 0, totalDuration: 0 };
        }

        statsByAgent[event.agentId].totalRuns++;
        if (event.eventType === 'STEP_COMPLETED') {
            statsByAgent[event.agentId].successfulRuns++;
            if (event.durationMs) {
                statsByAgent[event.agentId].totalDuration += event.durationMs;
            }
        }
    }

    return Object.entries(statsByAgent).map(([agentId, stats]) => ({
        agentId,
        totalRuns: stats.totalRuns,
        successfulRuns: stats.successfulRuns,
        averageDurationMs: stats.successfulRuns > 0 ? stats.totalDuration / stats.successfulRuns : 0,
    }));
  },

  /**
   * Apply a recovery strategy to a mission run.
   */
  async applyRecoveryStrategy(missionRunId: number, strategy: string, customInstructions?: string, userId?: string, proposedAction?: any): Promise<void> {
    const { RescueStrategyFactory } = await import("../utils/rescue-strategy-factory.js");
    await RescueStrategyFactory.apply(missionRunId, {
      strategy,
      customInstructions,
      userId,
      proposedAction
    });
  },

  /**
   * Update the mission plan (supervisor checklist).
   * Validates the plan and records a plan_edit checkpoint.
   */
  async updatePlan(missionRunId: number, plan: SupervisorPlan, userId: string): Promise<MissionRun> {
    logger.info(`Updating plan for mission run ${missionRunId} by ${userId}`);

    // 1. Validate plan structure
    const validatedPlan = SupervisorPlanSchema.parse(plan);

    const mission = await this.getByIdOrThrow(missionRunId);
    if (!mission.missionId) throw new Error("Mission Run not linked to a root mission");

    // 2. Perform the update
    return await db.transaction(async (tx) => {
      // Create a checkpoint with the new plan as context
      await this.checkpoint({
        missionRunId,
        missionId: mission.missionId!,
        missionContext: { plan: validatedPlan },
        reason: "plan_edit",
        changedBy: userId
      }, tx);

      // Return the updated mission run
      const [updated] = await tx
        .select()
        .from(missionRuns)
        .where(eq(missionRuns.id, missionRunId))
        .limit(1);

      return updated;
    });
  },

  /**
   * Simulate mission plan execution to estimate cost and complexity.
   */
  async simulatePlan(missionRunId: number): Promise<{
    estimatedTotalCostUsd: number;
    estimatedTimeMs: number;
    riskLevel: "low" | "medium" | "high";
    bottlenecks: string[];
    taskEstimates: Array<{ id: string, name: string; costUsd: number; timeMs: number }>;
  }> {
    const run = await this.getByIdOrThrow(missionRunId);

    // Fetch the root mission to check execution strategy
    const [mission] = await db
      .select()
      .from(missions)
      .where(eq(missions.id, run.missionId!))
      .limit(1);

    const plan = (run.missionContext as any)?.plan as SupervisorPlan;

    if (plan && plan.tasks && plan.tasks.length > 0) {
      let totalCost = 0;
      let totalTime = 0;
      const taskEstimates = [];
      const bottlenecks = [];

      for (const task of plan.tasks) {
        // Heuristic-based estimation
        const baseCost = 0.02;
        const complexity = (task.description?.length || 0) / 500;
        const estimatedCost = task.estimatedCostUSD
          ? Number(task.estimatedCostUSD)
          : baseCost + (complexity * 0.05);

        const estimatedTime = 5000 + (complexity * 10000);

        totalCost += estimatedCost;
        totalTime += estimatedTime;

        taskEstimates.push({
          id: task.id,
          name: task.name,
          costUsd: estimatedCost,
          timeMs: estimatedTime
        });

        if (task.dependencies && task.dependencies.length > 2) {
          bottlenecks.push(`Task "${task.name}" has high dependency count (${task.dependencies.length}), potential execution stall.`);
        }
      }

      let riskLevel: "low" | "medium" | "high" = "low";
      if (totalCost > 5.0) riskLevel = "high";
      else if (totalCost > 1.0 || bottlenecks.length > 0) riskLevel = "medium";

      return {
        estimatedTotalCostUsd: totalCost,
        estimatedTimeMs: totalTime,
        riskLevel,
        bottlenecks,
        taskEstimates
      };
    } else if (mission?.executionStrategy === "dynamic_autonomous") {
      // Heuristic for autonomous missions
      const complexity = (mission.objective?.length || 50) / 200;
      const totalCost = 0.5 + Math.min(complexity * 4.0, 4.5); // Base $0.50, capped at $5
      const totalTime = 1200000; // 20 minutes default

      return {
        estimatedTotalCostUsd: totalCost,
        estimatedTimeMs: totalTime,
        riskLevel: complexity > 1.5 ? "high" : (complexity > 0.8 ? "medium" : "low"),
        bottlenecks: [
          "Autonomous execution path is non-deterministic.",
          "Potential for 'reasoning loops' if objectives are ambiguous."
        ],
        taskEstimates: [
          { id: "dynamic-orchestration", name: "Dynamic Orchestration Cycle", costUsd: totalCost * 0.3, timeMs: totalTime * 0.3 },
          { id: "agent-reasoning", name: "Strategic Reasoning & Tool Selection", costUsd: totalCost * 0.4, timeMs: totalTime * 0.4 },
          { id: "tool-execution", name: "Estimated Tool Invocation Costs", costUsd: totalCost * 0.3, timeMs: totalTime * 0.3 }
        ]
      };
    } else {
      throw new Error("No active plan found to simulate. This mission requires a pre-defined plan or autonomous intent.");
    }
  },

  /**
   * Create a shadow run (parallel experiment).
   */
  async createShadowRun(data: { 
    parentRunId: number, 
    missionContext?: any, 
    modelId?: string, 
    promptVersion?: string,
    derivedFromShadowId?: number,
    ancestorShadowIds?: number[]
  }): Promise<MissionShadowRun> {
    const parent = await this.getByIdOrThrow(data.parentRunId);
    
    const [shadow] = await db
      .insert(missionShadowRuns)
      .values({
        parentRunId: data.parentRunId,
        status: "active",
        modelId: data.modelId || "current",
        promptVersion: data.promptVersion || "1.0",
        missionContext: data.missionContext || parent.missionContext as any,
        derivedFromShadowId: data.derivedFromShadowId,
        ancestorShadowIds: data.ancestorShadowIds || [],
      })
      .returning();

    if (!shadow) throw new Error("Failed to create shadow run");
    logger.info(`Created shadow run ${shadow.id} for parent run ${data.parentRunId}`);
    return shadow;
  },

  /**
   * Update shadow run metrics/status.
   */
  async shadowCheckpoint(shadowRunId: number, update: { 
    isSuccess?: boolean; 
    actualMetricValue?: number; 
    metricType?: string; 
    status?: string;
    missionContext?: Record<string, any>;
  }): Promise<void> {
    await db
      .update(missionShadowRuns)
      .set({
        ...update,
        ...(update.actualMetricValue !== undefined ? { actualMetricValue: update.actualMetricValue.toString() } : {}),
        updatedAt: new Date(),
      } as any)
      .where(eq(missionShadowRuns.id, shadowRunId));
    
    logger.info(`Updated shadow run ${shadowRunId} metrics`);

    // --- PHASE 3: AUTORESEARCH RECURSIVE LOOP ---
    // If the shadow run has completed, trigger autonomous evaluation and HIL proposal
    if (update.status === "completed") {
      (async () => {
        try {
          const { evaluationService } = await import("./evaluation.service.js");
          const { optimizationService } = await import("./optimization.service.js");
          const { critiqueService } = await import("./critique.service.js");
          const { synthesisService } = await import("./synthesis.service.js");
          const { roiService } = await import("./roi.service.js");
          
          // PHASE 4: Use Multi-Agent Critique for consensus evaluation
          const evaluation = await critiqueService.peerReview(shadowRunId);
          
          if (evaluation) {
            // Persist evaluation results (including consensus metadata)
            await db.update(missionShadowRuns)
              .set({
                evalScore: evaluation.score,
                evalReasoning: (evaluation as any).consensusReasoning || evaluation.reasoning,
                updatedAt: new Date()
              })
              .where(eq(missionShadowRuns.id, shadowRunId));

            if (evaluation.isImproved) {
              logger.info(`[Phase 4] Shadow run ${shadowRunId} is a CONSENSUS IMPROVEMENT (Score: ${evaluation.score}). Proposing optimization...`);
              await optimizationService.proposeOptimization(shadowRunId, evaluation);

              // --- AUTO-SYNTHESIS TRIGGER ---
              const [shadow] = await db.select().from(missionShadowRuns).where(eq(missionShadowRuns.id, shadowRunId)).limit(1);
              const [parent] = await db.select().from(missionRuns).where(eq(missionRuns.id, shadow.parentRunId)).limit(1);
              const [mission] = await db.select().from(missions).where(eq(missions.id, parent.missionId as number)).limit(1);

              if (mission?.autoSynthesis) {
                const recentShadows = await db.select().from(missionShadowRuns)
                  .where(and(
                    eq(missionShadowRuns.parentRunId, shadow.parentRunId),
                    eq(missionShadowRuns.status, "completed"),
                    gte(missionShadowRuns.evalScore, 70)
                  ))
                  .limit(3);
                
                if (recentShadows.length >= 2) {
                  logger.info(`[Phase 4] Auto-Synthesis triggered for mission ${mission.id} with ${recentShadows.length} high-performing candidates.`);
                  await synthesisService.synthesizeFromMultiple(shadow.parentRunId, recentShadows.map(s => s.id));
                }
              }
            } else {
              logger.info(`[Phase 4] Shadow run ${shadowRunId} consensus evaluation completed (Score: ${evaluation.score}). Improvement: false`);
            }
          }
        } catch (error: any) {
          logger.error(`[Phase 3] Error during autonomous evaluation: ${error.message}`);
        }
      })().catch(err => logger.error(`[Phase 3] Deferred evaluation error: ${err.message}`));
    }
  },

  /**
   * Get shadow runs for a parent.
   */
  async getShadowRuns(parentRunId: number): Promise<MissionShadowRun[]> {
    return db
      .select()
      .from(missionShadowRuns)
      .where(eq(missionShadowRuns.parentRunId, parentRunId))
      .orderBy(desc(missionShadowRuns.createdAt));
  },

  /**
   * Promote a shadow run's configuration to the primary mission.
   */
  async promoteShadowRun(shadowRunId: number, promotedBy: string = "system"): Promise<void> {
    const [shadow] = await db
      .select()
      .from(missionShadowRuns)
      .where(eq(missionShadowRuns.id, shadowRunId))
      .limit(1);
    
    if (!shadow) throw new Error("Shadow run not found");
    
    const parentRun = await this.getByIdOrThrow(shadow.parentRunId);
    const missionId = parentRun.missionId;
    if (!missionId) throw new Error("Parent run is not linked to a mission");

    // 1. Get the current mission
    const [mission] = await db
      .select()
      .from(missions)
      .where(eq(missions.id, missionId))
      .limit(1);
      
    if (!mission) throw new Error("Parent mission not found");
    
    // 2. Update the mission blackboard with the winning model/prompt
    const blackboard = (mission.blackboard as any) || {};
    const updatedBlackboard = {
      ...blackboard,
      primaryModelId: shadow.modelId,
      primaryPromptVersion: shadow.promptVersion,
      lastPromotedShadowId: shadow.id
    };
    
    // 3. Deactivate Shadow Mode (unless recursive) and persist blackboard
    const isRecursive = !!mission.recursiveOptimization;
    await db
      .update(missions)
      .set({
        isShadowMode: isRecursive, // Keep shadow mode on if recursive
        blackboard: updatedBlackboard,
        updatedAt: new Date(),
      })
      .where(eq(missions.id, missionId as number));
    
    logger.info(`Promoted shadow run ${shadowRunId} to primary for mission ${missionId}. New model: ${shadow.modelId}`);

    // Durably apply the improvement to the originating skill (if any) so it
    // compounds beyond this one mission's blackboard. Best-effort: the mission-level
    // promotion above has already succeeded, so a failure here is non-fatal.
    try {
      const { skillPromotionService } = await import("./skill-promotion.service.js");
      const result = await skillPromotionService.promoteToSkill(shadowRunId, promotedBy);
      if (result) {
        logger.info(`[Autoresearch] Skill ${result.skillId} durably updated (version ${result.versionId}) from shadow ${shadowRunId}`);
      }
    } catch (err: any) {
      logger.error(`[Autoresearch] Durable skill promotion failed for shadow ${shadowRunId}: ${err.message}`);
    }

    // PHASE 4/6: Recursive Optimization Trigger with ROI Guardrail
    if (isRecursive) {
      const { roiService } = await import("./roi.service.js");
      const viability = await roiService.shouldContinueRecursive(shadow.id);
      
      if (!viability.proceed) {
        logger.warn(`[Phase 6] Recursive Optimization TERMINATED for mission ${missionId}: ${viability.reason}`);
        await db.update(missions).set({ recursiveOptimization: false }).where(eq(missions.id, missionId));
      } else {
        logger.info(`[Phase 6] ROI Viable (${viability.reason}). Triggering next shadow iteration...`);
        await this.createShadowRun({
          parentRunId: shadow.parentRunId,
          derivedFromShadowId: shadow.id,
          modelId: shadow.modelId || undefined,
          promptVersion: shadow.promptVersion || undefined,
          missionContext: shadow.missionContext as any
        });
      }
    }
    
    // 4. Update shadow run status to reflect promotion
    await db
      .update(missionShadowRuns)
      .set({ status: "promoted", updatedAt: new Date() })
      .where(eq(missionShadowRuns.id, shadowRunId));
  },

  /**
   * Extract a shadow run's configuration into a reusable Mission Template.
   */
  async extractShadowRunToTemplate(shadowRunId: number, name: string, description?: string): Promise<any> {
    const [shadow] = await db
      .select()
      .from(missionShadowRuns)
      .where(eq(missionShadowRuns.id, shadowRunId))
      .limit(1);
    
    if (!shadow) throw new Error("Shadow run not found");
    
    const parentRun = await this.getByIdOrThrow(shadow.parentRunId);
    
    // Create the mission template
    const [template] = await db
      .insert(missionTemplates)
      .values({
        name,
        description: description || `Extracted from Shadow Run ${shadow.id} (${shadow.modelId})`,
        organizationId: parentRun.organizationId,
        config: {
          modelId: shadow.modelId,
          promptVersion: shadow.promptVersion,
          originalShadowRunId: shadow.id,
          extractedAt: new Date().toISOString()
        },
        createdBy: parentRun.createdBy,
      })
      .returning();

    logger.info(`Extracted shadow run ${shadowRunId} as template: ${template.name}`);
    return template;
  },

  /**
   * Spawn a new sub-mission with isolated budget and goal.
   * Enables agents to delegate complex tasks to autonomous hierarchies.
   */
  async spawnSubMission(options: {
    parentRunId: number;
    subGoal: string;
    budgetLimitUsd: number;
    name?: string;
  }): Promise<MissionRun> {
    const parentRun = await this.getByIdOrThrow(options.parentRunId);
    
    // Dynamic import to avoid circular dependency with MissionLifecycleService
    const { missionLifecycleService } = await import("./mission-lifecycle.service.js");
    
    // 1. Create the Child Mission
    const childMission = await missionLifecycleService.createMission({
      name: options.name || `Sub-Mission: ${options.subGoal.slice(0, 50)}`,
      objective: options.subGoal,
      organizationId: parentRun.organizationId ?? undefined,
      parentId: parentRun.missionId,
      budgetLimitUsd: options.budgetLimitUsd.toString(),
      executionStrategy: "dynamic_autonomous",
    }, parentRun.createdBy || "system");
    
    // 2. Launch the Child Mission Run
    const childRun = await this.create({
      missionId: childMission.id,
      organizationId: parentRun.organizationId ?? undefined,
      name: childMission.name,
      pipelineSequence: [], // Autonomous cycles are triggered by DynamicOrchestrator
      createdBy: parentRun.createdBy || "system",
      parentId: parentRun.id,
      missionContext: {
        isAutonomous: true,
        parent_mission_id: parentRun.missionId,
        parent_run_id: parentRun.id,
        delegated_goal: options.subGoal,
      }
    });
    
    // 3. Update Parent Blackboard with child reference for tracking
    const currentChildren = (parentRun.missionContext as any)?.active_sub_missions || [];
    await this.checkpoint({
      missionRunId: parentRun.id,
      missionId: parentRun.missionId!,
      missionContext: {
        active_sub_missions: [
          ...currentChildren,
          { 
            missionId: childMission.id, 
            runId: childRun.id, 
            goal: options.subGoal, 
            status: 'spawned',
            budget: options.budgetLimitUsd
          }
        ]
      },
      reason: `spawn_sub_mission:${childMission.id}`,
      changedBy: "agent:orchestrator"
    });
    
    correlatedLog.info("MissionRunService", `Spawned sub-mission ${childMission.id} for parent run ${parentRun.id}`, {
      parentMissionId: parentRun.missionId,
      childMissionId: childMission.id,
      budget: options.budgetLimitUsd
    });
    
    return childRun;
  },

  /**
   * Execution history for a mission run.
   *
   * cycle_run_events.run_id is a pipeline_executions.id, so a mission run id
   * cannot be used to look one up. This passed the mission run id straight
   * through, which meant GET /api/mission-runs/:id/history returned either
   * nothing or — where the two id spaces overlapped — some other execution's
   * steps, presented as this run's history.
   *
   * A run that has not reached a pipeline yet has no history, which is
   * different from a run whose history is empty only because we asked with the
   * wrong key.
   */
  async getRunEvents(runId: number, options?: { status?: string; stepCode?: string }) {
    const [run] = await db
      .select({ pipelineExecutionId: missionRuns.pipelineExecutionId })
      .from(missionRuns)
      .where(eq(missionRuns.id, runId))
      .limit(1);

    if (!run?.pipelineExecutionId) return [];

    const conditions = [eq(cycleRunEvents.runId, run.pipelineExecutionId)];
    if (typeof options?.status === 'string') {
      const eventType = options.status === 'failed' ? 'STEP_FAILED' : 'STEP_COMPLETED';
      conditions.push(eq(cycleRunEvents.eventType, eventType));
    }
    if (typeof options?.stepCode === 'string') {
      conditions.push(eq(cycleRunEvents.stepCode, options.stepCode));
    }

    return db
      .select()
      .from(cycleRunEvents)
      .where(and(...conditions))
      .orderBy(asc(cycleRunEvents.timestamp));
  },
};



