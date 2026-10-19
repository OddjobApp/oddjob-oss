import { db } from "@server/database_service.js";
import {
  missionRuns,
  missionBlackboardHistory,
  approvalRequests,
  jobs,
  agentDeployments,
  pipelineStepExecutions,
  hilForms,
  pipelineExecutions,
} from "@shared/schema/index.js";
import { eq, and, desc, inArray, sql, or, isNull } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { NotFoundError } from "@server/utils/errors.js";

const logger = createLogger("MissionTimelineService");

export type TimelineItem =
  | { type: "checkpoint"; blackboard: unknown; changeReason: string | null; createdAt: Date }
  | { type: "approval"; id: number; status: string; createdAt: Date; decisionAt: Date | null; comments?: string | null; modifiedOutput?: any; jobName?: string | null; formName?: string | null; decision?: string | null; contextSnapshot?: any };

export const missionTimelineService = {
  /**
   * Get reasoning feed (from missionBlackboardHistory with changeReason like "reasoning:*" or "thought:*").
   */
  async getReasoningFeed(missionRunId: number, missionId: number, dynamicTrace: any[], limit = 100): Promise<Array<{ text: string; changedBy: string; createdAt: Date }>> {
    // Pull reasoning from blackboard history
    const historyRows = await db
      .select({
        changeReason: missionBlackboardHistory.changeReason,
        changedBy: missionBlackboardHistory.changedBy,
        createdAt: missionBlackboardHistory.createdAt,
      })
      .from(missionBlackboardHistory)
      .where(eq(missionBlackboardHistory.missionId, missionId))
      .orderBy(desc(missionBlackboardHistory.createdAt))
      .limit(limit);

    const historyReasoning = historyRows
      .filter((r) => r.changeReason && (r.changeReason.startsWith("reasoning:") || r.changeReason.startsWith("thought:")))
      .map((r) => ({
        text: r.changeReason!.replace(/^(reasoning:|thought:)/, "").trim(),
        changedBy: r.changedBy,
        createdAt: r.createdAt,
      }));

    // Pull reasoning from dynamic trace (for autonomous missions)
    const trace = Array.isArray(dynamicTrace) ? dynamicTrace : [];
    const traceReasoning = trace
      .filter((t: any) => (t.type === "decision" && t.thought) || (t.type === "system" && (t.event === "decision_made" || t.event === "ai_thinking")))
      .map((t: any) => ({
        text: t.thought || t.note || `${t.event}${t.error ? ': ' + t.error : ''}`,
        changedBy: "agent:orchestrator",
        createdAt: new Date(t.timestamp),
      }));

    // Combine and sort by date descending
    const combined = [...historyReasoning, ...traceReasoning]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);

    return combined;
  },

  /**
   * Get checkpoints for a specific run.
   *
   * `checkpoint()` persists `missionRunId` on every history row. That foreign key
   * is the audit boundary; `changeReason` is descriptive text and is not required
   * to use a magic prefix. Filtering on `checkpoint:*` made valid persisted
   * checkpoints invisible and could not distinguish multiple runs of one mission.
   */
  async getCheckpoints(missionRunId: number, limit = 50, missionId?: number): Promise<Array<{ blackboard: unknown; changeReason: string | null; createdAt: Date }>> {
    let resolvedMissionId = missionId;

    if (!resolvedMissionId) {
      const mission = await db.select({ missionId: missionRuns.missionId })
        .from(missionRuns)
        .where(eq(missionRuns.id, missionRunId))
        .limit(1);
      
      resolvedMissionId = mission[0]?.missionId ?? undefined;
    }

    if (!resolvedMissionId) return [];

    const rows = await db
      .select({
        blackboard: missionBlackboardHistory.blackboard,
        changeReason: missionBlackboardHistory.changeReason,
        createdAt: missionBlackboardHistory.createdAt,
      })
      .from(missionBlackboardHistory)
      .where(and(
        eq(missionBlackboardHistory.missionId, resolvedMissionId),
        eq(missionBlackboardHistory.missionRunId, missionRunId),
      ))
      .orderBy(desc(missionBlackboardHistory.createdAt))
      .limit(limit);

    return rows.map((r) => ({ ...r, blackboard: r.blackboard }));
  },

  /**
   * Get combined timeline: checkpoints + approval events for Decision Timeline.
   * Merges missionBlackboardHistory (checkpoint:*) with approvalRequests for this mission.
   */
  async getTimeline(missionRunId: number, limit = 50, missionObj?: any): Promise<TimelineItem[]> {
    logger.info(`Fetching timeline for mission run ${missionRunId}`);
    
    let missionId: number | null = null;
    let pipelineExecutionId: number | null = null;

    if (missionObj) {
      missionId = missionObj.missionId;
      pipelineExecutionId = missionObj.pipelineExecutionId;
    } else {
      const run = await db.select({ missionId: missionRuns.missionId, pipelineExecutionId: missionRuns.pipelineExecutionId })
        .from(missionRuns)
        .where(eq(missionRuns.id, missionRunId))
        .limit(1);
      
      if (run.length > 0) {
        missionId = run[0].missionId;
        pipelineExecutionId = run[0].pipelineExecutionId;
      }
    }

    if (!missionId) {
      logger.warn(`MissionRun ${missionRunId} has no missionId, returning empty timeline`);
      return [];
    }

    const checkpoints = await this.getCheckpoints(missionRunId, limit, missionId);
    logger.info(`Found ${checkpoints.length} checkpoints for mission run ${missionRunId}`);

    // --- Optimized Approval Fetching ---
    const relExecs = await db.select({ id: pipelineExecutions.id })
      .from(pipelineExecutions)
      .where(or(
        eq(pipelineExecutions.missionRunId, missionRunId),
        eq(pipelineExecutions.missionId, missionId)
      ));
    
    const execIds = relExecs.map(e => e.id);
    
    let approvals: any[] = [];
    if (execIds.length > 0) {
      const stepExecs = await db.select({ id: pipelineStepExecutions.id })
        .from(pipelineStepExecutions)
        .where(inArray(pipelineStepExecutions.pipelineExecutionId, execIds));
      
      const stepExecIdsInts = stepExecs.map(se => se.id);

      if (stepExecIdsInts.length > 0) {
        approvals = await db
          .select({
            id: approvalRequests.id,
            status: approvalRequests.status,
            createdAt: approvalRequests.createdAt,
            decisionAt: approvalRequests.decisionAt,
            comments: approvalRequests.comments,
            modifiedOutput: approvalRequests.modifiedOutput,
            jobName: sql<string>`COALESCE(${jobs.name}, ${approvalRequests.modifiedOutput}->>'tool', ${approvalRequests.modifiedOutput}->>'stepName')`,
            agentSlug: agentDeployments.slug,
            formName: sql<string>`COALESCE(${hilForms.name}, ${approvalRequests.modifiedOutput}->>'formName', ${approvalRequests.modifiedOutput}->>'description')`,
            decision: sql<string>`COALESCE(
              ${approvalRequests.modifiedOutput}->>'strategic_decision',
              ${approvalRequests.modifiedOutput}->>'recovery_strategy',
              ${approvalRequests.modifiedOutput}->>'decision',
              ${approvalRequests.status}
            )`,
            contextSnapshot: sql<any>`COALESCE(
              ${approvalRequests.modifiedOutput}, 
              CASE 
                WHEN ${pipelineStepExecutions.output} ~ '^{' THEN (${pipelineStepExecutions.output})::jsonb -> 'context'
                ELSE NULL
              END,
              CASE 
                WHEN ${pipelineStepExecutions.output} ~ '^{' THEN (${pipelineStepExecutions.output})::jsonb
                ELSE jsonb_build_object('raw_output', ${pipelineStepExecutions.output})
              END
            )`
          })
          .from(approvalRequests)
          .leftJoin(jobs, eq(approvalRequests.jobId, jobs.id))
          .leftJoin(agentDeployments, eq(jobs.id, agentDeployments.jobId))
          .leftJoin(pipelineStepExecutions, eq(sql`${approvalRequests.executionId}::int`, pipelineStepExecutions.id))
          .leftJoin(hilForms, sql`CASE WHEN (${jobs.config}->>'formId') ~ '^[0-9]+$' THEN (${jobs.config}->>'formId')::int ELSE NULL END = ${hilForms.id}`)
          .where(inArray(sql`${approvalRequests.executionId}::int`, stepExecIdsInts))
          .orderBy(desc(approvalRequests.createdAt))
          .limit(limit);
      }
    }

    logger.info(`Found ${approvals.length} approvals for mission ${missionId}`);

    const timeline: TimelineItem[] = [
      ...checkpoints.map((c) => ({ type: "checkpoint" as const, ...c })),
      ...approvals.map((a: any) => ({
        type: "approval" as const,
        id: a.id,
        status: a.status,
        createdAt: a.createdAt,
        decisionAt: a.decisionAt,
        comments: a.comments,
        modifiedOutput: a.modifiedOutput,
        jobName: a.jobName,
        formName: a.formName,
        decision: a.decision,
        contextSnapshot: a.contextSnapshot,
      })),
    ];

    // --- Sub-Pipeline Checkpoints (Supervisor Logic) ---
    if (pipelineExecutionId) {
      const childExecs = await db
        .select({
          id: pipelineExecutions.id,
          pipelineId: pipelineExecutions.pipelineId,
          status: pipelineExecutions.status,
          completedAt: pipelineExecutions.completedAt,
          pipelineName: sql<string>`(SELECT name FROM pipelines WHERE id = ${pipelineExecutions.pipelineId})`
        })
        .from(pipelineExecutions)
        .where(
          and(
            eq(pipelineExecutions.parentExecutionId, pipelineExecutionId),
            eq(pipelineExecutions.status, "completed")
          )
        )
        .orderBy(desc(pipelineExecutions.completedAt));

      childExecs.forEach(ce => {
        if (ce.completedAt) {
          timeline.push({
            type: "checkpoint",
            blackboard: { note: `Completed sub-pipeline: ${ce.pipelineName}` },
            changeReason: `checklist:complete:${ce.pipelineName}`,
            createdAt: ce.completedAt
          });
        }
      });
    }

    timeline.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return timeline.slice(0, limit);
  }
};
