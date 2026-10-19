
import { EventEmitter } from "node:events";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("MissionEventBus");

export enum MissionEvent {
    PHASE_TRANSITION = "mission:phase_transition",
    TRACE_APPENDED = "mission:trace_appended",
    TRACE_FLUSHED = "mission:trace_flushed",
    AUDIT_CACHED = "mission:audit_cached",
    APP_FORGED = "mission:app_forged",
    RESCUE_STATUS_CHANGED = "mission:rescue_status_changed",
    /** A RUN reached "completed". Despite the name, this is per run, not per mission. */
    COMPLETED = "mission:completed",
    /**
     * The MISSION's own status became "completed". Fired once, by the writer that
     * flipped it — this is the event that drives completion notifications.
     */
    MISSION_STATUS_COMPLETED = "mission:status_completed",
    FAILED = "mission:failed",
    ERROR = "mission:error"
}

interface MissionEventPayloads {
    [MissionEvent.PHASE_TRANSITION]: { missionRunId: number, phase: string };
    [MissionEvent.TRACE_APPENDED]: { missionRunId: number, traceEntry: any };
    [MissionEvent.TRACE_FLUSHED]: { missionRunId: number, count: number };
    [MissionEvent.AUDIT_CACHED]: { missionRunId: number, hash: string };
    [MissionEvent.APP_FORGED]: { missionRunId: number, appId: number, name: string, slug: string };
    [MissionEvent.RESCUE_STATUS_CHANGED]: { missionRunId: number, rescueSessionId: number, previousStatus: string, newStatus: string };
    [MissionEvent.COMPLETED]: { missionRunId: number, status: string };
    [MissionEvent.MISSION_STATUS_COMPLETED]: { missionRunId: number, missionId: number, missionName: string, organizationId: number | null };
    [MissionEvent.FAILED]: { missionRunId: number, status: string, error?: string };
    [MissionEvent.ERROR]: { missionRunId: number, error: string };
}

class MissionEventBus extends EventEmitter {
    emit<K extends keyof MissionEventPayloads>(event: K, payload: MissionEventPayloads[K]): boolean {
        const runId = (payload as any).missionRunId;
        logger.debug(`[Mach 2] Emitting ${event} ${runId ? `for MissionRun ${runId}` : ''}`);
        return super.emit(event as string, payload);
    }

    on<K extends keyof MissionEventPayloads>(event: K, listener: (payload: MissionEventPayloads[K]) => void): this {
        return super.on(event as string, listener);
    }
}

export const missionEventBus = new MissionEventBus();

// Telemetry: log all phase transitions
missionEventBus.on(MissionEvent.PHASE_TRANSITION, ({ missionRunId, phase }) => {
    logger.info(`[Telemetry] Mission ${missionRunId} entered phase: ${phase}`);
});

// HARD FEATURE: Capture mission learnings to Knowledge Graph when mission completes
missionEventBus.on(MissionEvent.TRACE_FLUSHED, async ({ missionRunId }) => {
    // Check if mission is in terminal state
    try {
        const { db } = await import("@server/database_service.js");
        const { missionRuns } = await import("@shared/schema/index.js");
        const { eq } = await import("drizzle-orm");
        
        const [run] = await db
            .select({ status: missionRuns.status })
            .from(missionRuns)
            .where(eq(missionRuns.id, missionRunId))
            .limit(1);
            
        if (run?.status && ['completed', 'failed', 'cancelled'].includes(run.status)) {
            const { missionKnowledgeBridge } = await import("./mission-knowledge-bridge.js");
            const result = await missionKnowledgeBridge.captureMissionLearning(missionRunId);
            if (result.success) {
                logger.info(`[MissionEventBus] Captured mission ${missionRunId} learnings to KG: nodes [${result.nodeIds?.join(', ')}]`);
            }
        }
    } catch (err: any) {
        logger.error(`[MissionEventBus] Failed to capture mission learnings: ${err.message}`);
    }
});

// APP_FORGED: trigger nextPipelineId chaining + webhook notification for the linked deployment
missionEventBus.on(MissionEvent.APP_FORGED, ({ missionRunId, appId, name, slug }) => {
    (async () => {
        try {
            const { db } = await import("@server/database_service.js");
            const { appDeployments, apps } = await import("@shared/schema/apps.js");
            const { pipelines } = await import("@shared/schema/index.js");
            const { eq, and } = await import("drizzle-orm");

            // Find the deployment record for this app
            const [dep] = await db.select({
                id: appDeployments.id,
                webhookUrl: appDeployments.webhookUrl,
                webhookSecret: appDeployments.webhookSecret,
                webhookType: appDeployments.webhookType,
                nextPipelineId: appDeployments.nextPipelineId,
                organizationId: appDeployments.organizationId,
            })
                .from(appDeployments)
                .innerJoin(apps, eq(appDeployments.appId, apps.id))
                .where(eq(apps.slug, slug))
                .limit(1);

            if (!dep) return;

            // 1. Webhook notification
            if (dep.webhookUrl) {
                const payload = JSON.stringify({ event: "app_forged", appId, name, slug, missionRunId, timestamp: new Date().toISOString() });
                const headers: Record<string, string> = { "Content-Type": "application/json" };
                if (dep.webhookSecret) headers["X-Oddjob-Signature"] = dep.webhookSecret;
                await fetch(dep.webhookUrl, { method: "POST", headers, body: payload }).catch(e => {
                    logger.warn(`[AppForged] Webhook delivery to ${dep.webhookUrl} failed: ${e.message}`);
                });
                logger.info(`[AppForged] Webhook delivered to ${dep.webhookUrl}`);
            }

            // 2. App chaining — trigger nextPipelineId if configured
            if (dep.nextPipelineId) {
                const { executionService } = await import("@domain/pipeline/core/execution-service.js");
                const { getSystemOrgContext } = await import("@server/utils/auth-context.js");
                await executionService.run(dep.nextPipelineId, {
                    triggeredBy: "app_forge_chain",
                    sourceAppId: appId,
                    sourceMissionRunId: missionRunId,
                } as any, getSystemOrgContext(dep.organizationId));
                logger.info(`[AppForged] Chained pipeline ${dep.nextPipelineId} triggered for app ${slug}`);
            }
        } catch (err: any) {
            logger.error(`[AppForged] Downstream handler failed: ${err.message}`);
        }
    })().catch(err => logger.error(`[AppForged] Unhandled error in deferred handler: ${err.message}`));
});

// COMPLETED: Emit stage_handoff when "Core Application Development" mission completes (Development → QA)
missionEventBus.on(MissionEvent.COMPLETED, ({ missionRunId }) => {
    (async () => {
        try {
            const { db } = await import("@server/database_service.js");
            const { missionRuns, missions } = await import("@shared/schema/index.js");
            const { eq } = await import("drizzle-orm");
            const { eventStream } = await import("@domain/core/infrastructure/event-stream.service.js");

            const [run] = await db.select({
                missionId: missionRuns.missionId,
                organizationId: missionRuns.organizationId,
            }).from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
            if (!run?.missionId) return;

            const [mission] = await db.select({ name: missions.name })
                .from(missions).where(eq(missions.id, run.missionId)).limit(1);
            if (!mission) return;

            // Only emit stage_handoff for Core Application Development → QA
            if (mission.name === "Core Application Development") {
                await eventStream.publish("stage_handoff", {
                    sourceStage: "Development",
                    targetStage: "QA",
                    sourceMission: "Core Application Development",
                    targetMission: "Quality Assurance & Testing",
                    ticketKeys: [],
                    triggeredBy: "mission-orchestrator",
                    runId: missionRunId,
                }, { organizationId: run.organizationId });
                logger.info(`[StageHandoff] Emitted Development → QA handoff for run ${missionRunId}`);
            }
        } catch (err: any) {
            logger.error(`[StageHandoff] Failed to emit stage_handoff for run ${missionRunId}: ${err.message}`);
        }
    })().catch(err => logger.error(`[StageHandoff] Unhandled error: ${err.message}`));
});

// RESCUE_STATUS_CHANGED: update mission blackboard with latest rescue status
missionEventBus.on(MissionEvent.RESCUE_STATUS_CHANGED, ({ missionRunId, rescueSessionId, newStatus }) => {
    (async () => {
        try {
            const { missionRunService } = await import("@domain/mission/core/mission-run.service.js");
            const { db } = await import("@server/database_service.js");
            const { missionRuns } = await import("@shared/schema/index.js");
            const { eq } = await import("drizzle-orm");

            const [run] = await db.select({ missionId: missionRuns.missionId })
                .from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
            if (!run?.missionId) return;

            await missionRunService.checkpoint({
                missionRunId,
                missionId: run.missionId,
                missionContext: { rescue_status: newStatus, rescue_session_id: rescueSessionId },
                reason: `Rescue session ${rescueSessionId} status → ${newStatus}`,
                changedBy: "rescue-service",
            });
        } catch (err: any) {
            logger.error(`[RescueStatusChanged] Blackboard sync failed: ${err.message}`);
        }
    })().catch(err => logger.error(`[RescueStatusChanged] Unhandled: ${err.message}`));
});
