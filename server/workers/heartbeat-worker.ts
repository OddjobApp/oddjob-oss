import { Job, Queue } from "bullmq";
import { eq, and } from "drizzle-orm";
import { BaseWorker } from "./base-worker.js";
import { QUEUE_NAMES } from "../domain/core/infrastructure/queue/queue-service.js";
import { getRedisOptions } from "../domain/core/infrastructure/redis/redis-client.js";
import { db } from "../database_service.js";
import { heartbeatTriggers } from "@shared/schema/heartbeat-triggers.js";
import { createLogger } from "@server/utils/logger.js";
import { pollHeartbeatSource } from "./heartbeat-sources.js";
import type { HeartbeatTrigger } from "@shared/schema/heartbeat-triggers.js";

const logger = createLogger("HeartbeatWorker");

// ============================================================================
// HEARTBEAT WORKER
// Processes repeatable "heartbeat-poll" jobs — one per active heartbeat trigger.
// On each fire the worker polls the source adapter, checks for new items since
// the last poll (the `lastItemId` watermark), and emits a
// "create-mission-from-heartbeat" job per new item. The same worker consumes
// those and materializes them as launched missions assigned to the trigger's
// agent deployment.
//
// Architecture:
//   1. On startup, `scheduleAllTriggers()` enqueues a repeatable job for each
//      active heartbeat_trigger row.
//   2. The BullMQ scheduler fires each job at `pollingIntervalMs` intervals.
//   3. `execute()` reads the trigger config, polls the source, updates the
//      lastItemId watermark, and queues mission-creation jobs on this queue.
//
// Both job names live on QUEUE_NAMES.HEARTBEAT — heartbeat jobs must never be
// enqueued on STEPS (pipeline steps) or SYSTEM (other consumers) — see
// AGENTS.md "built but never wired".
// ============================================================================

export interface HeartbeatJobData {
    triggerId: number;
    orgId: number;
    agentDeploymentId: number | null;
    sourceType: string;
    sourceConfig: Record<string, unknown>;
    lastItemId: string | null;
    missionTitleTemplate: string | null;
    missionPriority: string | null;
}

export interface HeartbeatMissionJobData {
    orgId: number;
    agentDeploymentId: number | null;
    triggerId: number;
    sourceType: string;
    item: Record<string, unknown>;
    missionTitle: string;
    missionPriority: string;
}

export class HeartbeatWorker extends BaseWorker<HeartbeatJobData | HeartbeatMissionJobData, void> {
    private readonly heartbeatQueue: Queue;

    constructor() {
        super(QUEUE_NAMES.HEARTBEAT, { concurrency: 10 });

        this.heartbeatQueue = new Queue(QUEUE_NAMES.HEARTBEAT, {
            connection: { ...getRedisOptions(), maxRetriesPerRequest: null },
        });
    }

    protected async execute(job: Job<HeartbeatJobData | HeartbeatMissionJobData>): Promise<void> {
        if (job.name === "heartbeat-poll") {
            return await this._poll(job as Job<HeartbeatJobData>);
        }
        if (job.name === "create-mission-from-heartbeat") {
            return await this._createMission(job as Job<HeartbeatMissionJobData>);
        }
        logger.warn(`Ignoring unknown heartbeat job: ${job.name}`);
    }

    private async _poll(job: Job<HeartbeatJobData>): Promise<void> {
        const {
            triggerId,
            orgId,
            agentDeploymentId,
            sourceType,
            sourceConfig,
            missionTitleTemplate,
            missionPriority,
        } = job.data;

        logger.info(`Polling heartbeat trigger ${triggerId} (${sourceType}) for org ${orgId}`);

        // Fetch fresh config in case it changed since the job was enqueued
        const [trigger] = await db
            .select()
            .from(heartbeatTriggers)
            .where(
                and(
                    eq(heartbeatTriggers.id, triggerId),
                    eq(heartbeatTriggers.isActive, true),
                )
            )
            .limit(1);

        if (!trigger) {
            logger.warn(`Trigger ${triggerId} is no longer active — skipping`);
            return;
        }

        // Watermark comes from the fresh row — the copy in job.data was
        // captured at schedule time and is stale after the first poll.
        const lastItemId = trigger.lastItemId ?? null;
        const newItems = await pollHeartbeatSource(sourceType, sourceConfig, lastItemId, orgId);

        if (newItems.length === 0) {
            logger.debug(`No new items for trigger ${triggerId}`);
            return;
        }

        logger.info(`Found ${newItems.length} new item(s) for trigger ${triggerId}`);

        // Update the watermark cursor — items arrive oldest → newest.
        const latestItemId = newItems[newItems.length - 1]?.id ?? lastItemId;
        await db
            .update(heartbeatTriggers)
            .set({
                lastItemId: latestItemId ? String(latestItemId) : null,
                lastPolledAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(heartbeatTriggers.id, triggerId));

        // Emit one mission-creation job per new item
        for (const item of newItems) {
            const title = missionTitleTemplate
                ? missionTitleTemplate.replace(
                      /\{\{(\w+)\}\}/g,
                      (_, key) => String((item as any)[key] ?? ""),
                  )
                : `Heartbeat: ${sourceType} — ${item.title ?? item.subject ?? item.id ?? "new item"}`;

            await this.heartbeatQueue.add(
                "create-mission-from-heartbeat",
                {
                    orgId,
                    agentDeploymentId,
                    triggerId,
                    sourceType,
                    item,
                    missionTitle: title,
                    missionPriority: missionPriority ?? "normal",
                } satisfies HeartbeatMissionJobData,
                {
                    attempts: 3,
                    backoff: { type: "exponential", delay: 5000 },
                },
            );
        }
    }

    /**
     * Materializes a polled item as a mission assigned to the trigger's agent
     * deployment (resolved to its backing job as the primary member), then
     * launches it — the standing agent picks up the work on its next step.
     */
    private async _createMission(job: Job<HeartbeatMissionJobData>): Promise<void> {
        const { orgId, agentDeploymentId, triggerId, sourceType, item, missionTitle } = job.data;

        const members: { entityType: string; entityId: number; role: string }[] = [];
        if (agentDeploymentId != null) {
            const { agentDeployments } = await import("@shared/schema/agent-deployments.js");
            const [deployment] = await db
                .select()
                .from(agentDeployments)
                .where(
                    and(
                        eq(agentDeployments.id, agentDeploymentId),
                        eq(agentDeployments.organizationId, orgId),
                    )
                )
                .limit(1);
            if (deployment) {
                members.push({ entityType: "job", entityId: deployment.jobId, role: "primary" });
            } else {
                logger.warn(
                    `Deployment ${agentDeploymentId} not found in org ${orgId} — mission created unassigned`,
                );
            }
        }

        const { missionService } = await import("../domain/mission/core/mission.service.js");
        const mission = await missionService.createMission(
            {
                name: missionTitle,
                objective:
                    `Inbound ${sourceType} item raised by heartbeat trigger ${triggerId}.\n\n` +
                    JSON.stringify(item, null, 2).slice(0, 4000),
                organizationId: orgId,
                executionStrategy: "dynamic_autonomous",
            },
            "heartbeat",
            members,
        );

        const result = await missionService.launchMission(mission.id, "heartbeat", orgId, undefined, {
            source: "heartbeat",
            triggerId,
            sourceType,
        });

        if (!result.success) {
            throw new Error(`Mission ${mission.id} created but launch failed: ${result.error}`);
        }

        logger.info(`Heartbeat trigger ${triggerId}: launched mission ${mission.id} (${missionTitle})`);
    }

    /**
     * Schedules repeatable BullMQ jobs for all active heartbeat triggers.
     * Should be called once on worker startup.
     */
    async scheduleAllTriggers(): Promise<void> {
        const activeTriggers = await db
            .select()
            .from(heartbeatTriggers)
            .where(eq(heartbeatTriggers.isActive, true));

        logger.info(`Scheduling ${activeTriggers.length} heartbeat trigger(s)`);

        for (const trigger of activeTriggers) {
            await this._scheduleTrigger(trigger);
        }
    }

    /**
     * Adds/updates the repeatable job for a single trigger.
     * Called when a new trigger is created via the API.
     */
    async scheduleTrigger(trigger: HeartbeatTrigger): Promise<void> {
        await this._scheduleTrigger(trigger);
    }

    /**
     * Removes the repeatable job for a trigger (on deactivation or deletion).
     */
    async unscheduleTrigger(trigger: HeartbeatTrigger): Promise<void> {
        await this.heartbeatQueue.removeRepeatable(
            "heartbeat-poll",
            { every: trigger.pollingIntervalMs },
            `heartbeat:${trigger.id}`,
        );
        logger.info(`Unscheduled heartbeat trigger ${trigger.id}`);
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private async _scheduleTrigger(trigger: HeartbeatTrigger): Promise<void> {
        const jobId = `heartbeat:${trigger.id}`;

        await this.heartbeatQueue.add(
            "heartbeat-poll",
            {
                triggerId: trigger.id,
                orgId: trigger.orgId,
                agentDeploymentId: trigger.agentDeploymentId ?? null,
                sourceType: trigger.sourceType,
                sourceConfig: (trigger.sourceConfig as Record<string, unknown>) ?? {},
                lastItemId: trigger.lastItemId ?? null,
                missionTitleTemplate: trigger.missionTitleTemplate ?? null,
                missionPriority: trigger.missionPriority ?? "normal",
            } satisfies HeartbeatJobData,
            {
                repeat: { every: trigger.pollingIntervalMs },
                jobId,
                // Don't fail silently — send to DLQ on exhaustion
                attempts: 3,
                backoff: { type: "exponential", delay: 5000 },
            },
        );
    }
}

// Singleton
let workerInstance: HeartbeatWorker | null = null;

export function startHeartbeatWorker(): HeartbeatWorker {
    if (!workerInstance) {
        workerInstance = new HeartbeatWorker();
        // Schedule all active triggers on startup (fire-and-forget, errors are logged)
        workerInstance.scheduleAllTriggers().catch((e) => {
            logger.error(`Failed to schedule heartbeat triggers on startup: ${e.message}`);
        });
    }
    return workerInstance;
}
