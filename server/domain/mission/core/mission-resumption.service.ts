
import { db } from "@server/database_service.js";
import { missionRuns, pipelineStepExecutions, jobs, missions, type ResumeCondition } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { missionCorrelationService, correlatedLog } from "./mission-correlation.service.js";

const logger = createLogger("MissionResumptionService");

export class MissionResumptionService {
    async pauseForFile(missionRunId: number, folderPath: string, filePattern: string, pipelineExecutionId: number, stepId: number) {
        const resumeCondition: ResumeCondition = { type: "file", folderPath, filePattern, pipelineExecutionId, stepId };
        await db.update(missionRuns).set({ status: "waiting_on_file", resumeCondition, updatedAt: new Date() }).where(eq(missionRuns.id, missionRunId));
    }

    async pauseForHumanApproval(missionRunId: number, approvalRequestIds: number[], selectionList?: any[]) {
        const resumeCondition: ResumeCondition = { type: "human_approval", approvalRequestIds, selectionList };
        await db.update(missionRuns).set({ status: "waiting_on_human", resumeCondition, updatedAt: new Date() }).where(eq(missionRuns.id, missionRunId));

        // Notify each approver by email via the existing approval service
        if (approvalRequestIds.length > 0) {
            this.notifyApprovers(missionRunId, approvalRequestIds).catch(err =>
                logger.warn(`[MissionResumption] Approval notification failed for run ${missionRunId}: ${err.message}`)
            );
        }
    }

    private async notifyApprovers(missionRunId: number, approvalRequestIds: number[]) {
        const { approvalService } = await import("@server/domain/integrations/core/approval.service.js");
        const [run] = await db.select({ missionId: missionRuns.missionId, organizationId: missionRuns.organizationId })
            .from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);

        for (const requestId of approvalRequestIds) {
            try {
                await approvalService.triggerNotifications(requestId, {
                    missionRunId,
                    missionId: run?.missionId ?? undefined,
                    organizationId: run?.organizationId ?? undefined,
                });
            } catch (err: any) {
                logger.warn(`[MissionResumption] Could not notify for approval ${requestId}: ${err.message}`);
            }
        }
    }

    async resumeMissionRun(missionRunId: number, matchedFilePath?: string) {
        const [mission] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
        if (!mission) return;

        // A delayed wake-up must not resurrect a run that has already ended.
        // The compare-and-set below protects changes after this read, but alone
        // would also accept a terminal status observed here.
        if (!["active", "paused", "waiting_on_human", "waiting_on_file"].includes(mission.status)) {
            logger.info(`[MissionResumption] Run ${missionRunId} is ${mission.status}; skipping wake-up.`);
            return;
        }

        const rc = mission.resumeCondition;
        // Compare-and-set the status we observed. Maintenance may reap an active
        // zombie between the read above and this write; an unconditional update
        // used to resurrect that freshly failed run back to `active`, leaving its
        // stale failure reason attached and consuming an org concurrency slot.
        const [resumed] = await db.update(missionRuns)
            .set({ status: "active", resumeCondition: null, updatedAt: new Date() })
            .where(and(eq(missionRuns.id, missionRunId), eq(missionRuns.status, mission.status)))
            .returning({ id: missionRuns.id });
        if (!resumed) {
            logger.info(`[MissionResumption] Run ${missionRunId} changed state while resuming; skipping stale wake-up.`);
            return;
        }

        if (rc?.type === "file" && rc.pipelineExecutionId != null && rc.stepId != null) {
            const resumeData = matchedFilePath ? { matched_file_path: matchedFilePath } : {};
            await db.update(missionRuns).set({ missionContext: { ...(mission.missionContext as any), ...resumeData }, updatedAt: new Date() }).where(eq(missionRuns.id, missionRunId));
            const { pipelineExecutor } = await import("@server/core/pipeline-executor.js");
            await pipelineExecutor.resumePipelineExecution(rc.pipelineExecutionId, rc.stepId, resumeData);
        }

        // Strategy-based restart
        const [rootMission] = await db.select().from(missions).where(eq(missions.id, mission.missionId!)).limit(1);
        const strategy = rootMission?.executionStrategy || (mission.missionContext as any)?.executionStrategy;
        
        if (strategy === "rolling_wave") {
            const { scheduleMissionWave } = await import("../infrastructure/rolling-wave-queue.js");
            await scheduleMissionWave({ missionRunId, userId: mission.createdBy || "system", orgId: mission.organizationId || null });
        } else if (strategy === "dynamic_autonomous" || strategy === "parallel_fan_out") {
            const { queueMissionCycle } = await import("../infrastructure/dynamic-mission-queue.js");
            await queueMissionCycle({ missionRunId, userId: mission.createdBy || "system", orgId: mission.organizationId || null }, 0);
        } else if (strategy === "pre_planned") {
            // pre_planned is the overwhelming majority of missions and had no branch
            // here at all, so resuming one flipped its status back to "active", bumped
            // updated_at and queued nothing. The stale-run watchdog then re-detected
            // the same run and repeated that indefinitely without progress.
            const { missionExecutionService } = await import("./mission-execution.service.js");
            await missionExecutionService.resumeSequence(missionRunId);
        } else {
            // Never fail silently again: an unrecognised strategy previously looked
            // exactly like a successful resume.
            logger.warn(
                `[MissionResumption] Run ${missionRunId} has execution strategy "${strategy ?? "(none)"}", which has no restart path. ` +
                `Status was set to active but no work was queued.`
            );
        }
    }
}

export const missionResumptionService = new MissionResumptionService();
