/**
 * Reactive Orchestrator Service
 * 
 * Execution strategy: "reactive"
 * 
 * A dormant mission that stays in a "listening" state and only wakes when
 * an external event trigger arrives. Triggers can come from:
 *   - Webhooks (via integration routes)
 *   - Email (via AgentMail webhook)
 *   - File uploads (via knowledge document events)
 *   - Manual pokes (via API)
 *   - EventStream messages from other pods
 *   - Schedule ticks (via scheduledJobs)
 * 
 * Flow:
 *   1. Launch creates a run in "listening" status
 *   2. Registers event subscriptions in the blackboard (triggerConfig)
 *   3. When an event arrives via handleTrigger(), the run wakes up
 *   4. Event payload is written to blackboard as triggerEvent
 *   5. A single dynamic_autonomous cycle processes the event
 *   6. After processing, the run returns to "listening" (unless it CONCLUDEs)
 * 
 * triggerConfig format in blackboard:
 *   triggerConfig: {
 *     eventTypes: ["webhook.received", "email.received", "file.uploaded"],
 *     webhookPath?: string,        // Custom webhook path to listen on
 *     emailInbox?: string,         // AgentMail inbox to monitor
 *     maxTriggers?: number,        // Auto-conclude after N triggers (0 = unlimited)
 *     cooldownMs?: number          // Minimum gap between triggers (debounce)
 *   }
 */

import { db } from "@server/database_service.js";
import { missions, missionRuns } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { queueMissionCycle } from "../infrastructure/dynamic-mission-queue.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("ReactiveOrchestrator");

export const reactiveOrchestratorService = {

    async launchMission(missionId: number, userId: string, orgId: number | null) {
        const [mission] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
        if (!mission) throw new Error("Mission not found");

        const { missionRunService } = await import("./mission-run.service.js");

        const blackboard = (mission.blackboard as Record<string, any>) || {};
        const triggerConfig = blackboard.triggerConfig || {};

        if (!triggerConfig.eventTypes || triggerConfig.eventTypes.length === 0) {
            return { success: false, error: "Reactive mission requires blackboard.triggerConfig.eventTypes to be defined" };
        }

        const run = await missionRunService.create({
            missionId,
            organizationId: orgId ?? undefined,
            name: `Reactive: ${mission.name}`,
            createdBy: userId,
            pipelineSequence: []
        });

        const initialContext: Record<string, any> = {
            ...blackboard,
            intent: mission.objective,
            executionStrategy: 'reactive',
            launchedByUserId: userId,
            triggerConfig,
            triggerCount: 0,
            triggerHistory: [],
            status: 'listening',
            rulesOfEngagement: {
                maxBudgetUsd: mission.budgetLimitUsd ? parseFloat(String(mission.budgetLimitUsd)) : 50.00,
                maxCycles: triggerConfig.maxTriggers || 0, // 0 = unlimited
                hilStrictness: mission.hilStrictness || "moderate",
                notificationChannels: mission.hilNotificationChannels || ["inbox"]
            },
            allowedTools: blackboard.allowedTools || [],
            cycleCount: 0
        };

        await missionRunService.update(run.id, {
            status: "active", // Active but listening — not processing
            missionContext: initialContext
        });

        // Register the reactive listener with the event stream
        this.registerListeners(run.id, missionId, orgId, triggerConfig);

        logger.info(`[Reactive] Mission run ${run.id} launched in listening mode for events: ${triggerConfig.eventTypes.join(", ")}`);
        return { success: true, missionRunId: run.id, missionId };
    },

    /**
     * Register event stream listeners for this reactive mission.
     * These are in-process listeners that survive as long as the server runs.
     * On restart, active reactive missions should be re-registered via init.
     */
    registerListeners(missionRunId: number, missionId: number, orgId: number | null, triggerConfig: any) {
        const eventTypes: string[] = triggerConfig.eventTypes || [];

        for (const eventType of eventTypes) {
            logger.info(`[Reactive] Registering listener for ${eventType} on run ${missionRunId}`);
            eventStream.on(eventType, async (event: any) => {
                logger.info(`[Reactive] Event ${eventType} received on run ${missionRunId}. Checking relevance...`);
                // Check if this event is relevant to this mission
                const isRelevant = this.isEventRelevant(event, missionId, orgId, triggerConfig);
                if (!isRelevant) {
                    logger.debug(`[Reactive] Event ${eventType} ignored for run ${missionRunId} (not relevant)`);
                    return;
                }

                logger.info(`[Reactive] Event ${eventType} verified for mission run ${missionRunId}`);
                await this.handleTrigger(missionRunId, eventType, event).catch(err => {
                    logger.error(`[Reactive] Failed to handle trigger for run ${missionRunId}: ${err.message}`);
                });
            });
        }

        logger.debug(`[Reactive] Registered ${eventTypes.length} event listeners for run ${missionRunId}`);
    },

    /**
     * Check if an event payload is relevant to this specific reactive mission.
     */
    isEventRelevant(event: any, missionId: number, orgId: number | null, triggerConfig: any): boolean {
        // Filter by organization if present
        const eventOrgId = event.context?.organizationId || event.payload?.organizationId;
        if (orgId && eventOrgId && eventOrgId !== orgId) return false;

        // Filter by webhook path if configured
        if (triggerConfig.webhookPath && event.payload?.path && event.payload?.path !== triggerConfig.webhookPath) return false;

        // Filter by email inbox if configured
        if (triggerConfig.emailInbox && event.payload?.inbox && event.payload?.inbox !== triggerConfig.emailInbox) return false;

        return true;
    },

    /**
     * Handle an incoming trigger event. This is the main entry point for waking
     * a reactive mission.
     */
    async handleTrigger(missionRunId: number, eventType: string, eventPayload: any) {
        const { missionRunService } = await import("./mission-run.service.js");
        const { missionService } = await import("./mission.service.js");

        const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
        if (!run) {
            logger.warn(`[Reactive] Run ${missionRunId} not found for trigger`);
            return;
        }

        if (run.status !== "active") {
            logger.debug(`[Reactive] Run ${missionRunId} not active (${run.status}), ignoring trigger`);
            return;
        }

        const context = (run.missionContext as Record<string, any>) || {};
        const triggerConfig = context.triggerConfig || {};

        // Debounce / cooldown check
        if (triggerConfig.cooldownMs) {
            const lastTriggerTime = context.lastTriggerTimestamp;
            if (lastTriggerTime && (Date.now() - new Date(lastTriggerTime).getTime()) < triggerConfig.cooldownMs) {
                logger.debug(`[Reactive] Run ${missionRunId} in cooldown, ignoring trigger`);
                return;
            }
        }

        // Max triggers check
        const maxTriggers = triggerConfig.maxTriggers || 0;
        const triggerCount = (context.triggerCount || 0) + 1;
        if (maxTriggers > 0 && triggerCount > maxTriggers) {
            logger.info(`[Reactive] Run ${missionRunId} reached max triggers (${triggerCount}/${maxTriggers}). Auto-concluding.`);
            await missionRunService.update(missionRunId, {
                status: "completed",
                missionContext: {
                    ...context,
                    result: `Reactive mission concluded after ${triggerCount - 1} triggers (limit: ${maxTriggers})`
                }
            });
            return;
        }

        // Write trigger to blackboard
        const triggerEntry = {
            eventType,
            payload: eventPayload,
            timestamp: new Date().toISOString(),
            triggerNumber: triggerCount
        };

        const triggerHistory = [...(context.triggerHistory || []).slice(-19), triggerEntry]; // Keep last 20

        await missionRunService.update(missionRunId, {
            missionContext: {
                ...context,
                triggerCount,
                lastTriggerTimestamp: new Date().toISOString(),
                triggerHistory,
                triggerEvent: triggerEntry, // Current trigger visible to AI
                status: 'processing'
            }
        });

        // Write to mission blackboard for AI visibility
        if (run.missionId) {
            await missionService.updateBlackboard(run.missionId, {
                last_trigger: triggerEntry,
                trigger_count: triggerCount
            }, "system:reactive", `trigger:${eventType}`);
        }

        // Queue a dynamic cycle to process this event
        const userId = context.launchedByUserId || run.createdBy || "system";
        await queueMissionCycle({ missionRunId, userId, orgId: run.organizationId }, 0);
        logger.info(`[Reactive] Queued processing cycle for run ${missionRunId} (trigger #${triggerCount}: ${eventType})`);
    },

    /**
     * Called after a dynamic cycle completes for a reactive mission.
     * Returns the run to "listening" state unless it CONCLUDEd or FAILed.
     */
    async returnToListening(missionRunId: number) {
        const { missionRunService } = await import("./mission-run.service.js");
        const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
        if (!run) return;

        // Only return to listening if still active (CONCLUDE/FAIL handled by dynamic orchestrator)
        if (run.status === "active") {
            const context = (run.missionContext as Record<string, any>) || {};
            await missionRunService.update(missionRunId, {
                missionContext: {
                    ...context,
                    triggerEvent: null, // Clear processed trigger
                    status: 'listening'
                }
            });
            logger.info(`[Reactive] Run ${missionRunId} returned to listening state`);
        }
    },

    /**
     * Re-register listeners for all active reactive missions.
     * Called on server startup.
     */
    async initializeActiveListeners() {
        const activeRuns = await db.select()
            .from(missionRuns)
            .where(eq(missionRuns.status, "active"));

        let registered = 0;
        for (const run of activeRuns) {
            const context = (run.missionContext as Record<string, any>) || {};
            if (context.executionStrategy !== 'reactive') continue;
            if (!context.triggerConfig) continue;

            this.registerListeners(run.id, run.missionId!, run.organizationId, context.triggerConfig);
            registered++;
        }

        if (registered > 0) {
            logger.info(`[Reactive] Re-registered listeners for ${registered} active reactive missions`);
        }
    }
};
