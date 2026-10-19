/**
 * Human-Driven Orchestrator Service
 * 
 * Execution strategy: "human_driven"
 * 
 * Operates like dynamic_autonomous but gates EVERY action through human approval.
 * The AI reasons and proposes a next action, but instead of executing immediately,
 * it creates an approval request and pauses until the user approves or rejects.
 * 
 * Flow per cycle:
 *   1. AI reasons over blackboard → produces decision (same as dynamic)
 *   2. Instead of executing, create an approval request with the proposed action
 *   3. Set missionRun status to "waiting_on_human"
 *   4. On approval: execute the action, write result to blackboard, queue next cycle
 *   5. On rejection: write rejection reason to blackboard, queue next cycle (AI replans)
 * 
 * Resume is handled via the existing HIL approval flow in mission-runs.route.ts.
 */

import { db } from "@server/database_service.js";
import { missions, missionRuns, users, jobs, missionMembers } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { queueMissionCycle } from "../infrastructure/dynamic-mission-queue.js";

const logger = createLogger("HumanDrivenOrchestrator");

export const humanDrivenOrchestratorService = {

    /**
     * Launch a human-driven mission. Identical to dynamic launch but sets
     * hilStrictness to "strict" and marks the strategy in context.
     */
    async launchMission(missionId: number, userId: string, orgId: number | null) {
        const [mission] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
        if (!mission) throw new Error("Mission not found");

        const { missionRunService } = await import("./mission-run.service.js");
        const { missionService } = await import("./mission.service.js");

        const missionBlackboard = (mission.blackboard as Record<string, any>) || {};

        // Resolve allowed tools from mission members (heuristic: tools from all job members)
        const missionTools = await db
            .select({ toolName: jobs.tool })
            .from(missionMembers)
            .innerJoin(jobs, eq(missionMembers.entityId, jobs.id))
            .where(and(eq(missionMembers.missionId, missionId), eq(missionMembers.entityType, 'job')));
        
        const allowedTools = Array.from(new Set(missionTools.map((t: any) => t.toolName).filter(Boolean)));
        
        // Add core tools by default
        const CORE_CAPABILITIES = ['get_blackboard', 'update_blackboard', 'file_list', 'file_read', 'file_write', 'google_search', 'browse_web'];
        for (const tool of CORE_CAPABILITIES) {
            if (!allowedTools.includes(tool)) allowedTools.push(tool);
        }

        const run = await missionRunService.create({
            missionId,
            organizationId: orgId ?? undefined,
            name: `Human-Driven: ${mission.name}`,
            createdBy: userId,
            pipelineSequence: []
        });

        const initialContext = {
            ...missionBlackboard,
            intent: mission.objective,
            executionStrategy: 'human_driven',
            launchedByUserId: userId,
            rulesOfEngagement: {
                maxBudgetUsd: mission.budgetLimitUsd ? parseFloat(String(mission.budgetLimitUsd)) : 50.00,
                maxCycles: 50,
                hilStrictness: "strict", // Always strict — every action requires approval
                notificationChannels: mission.hilNotificationChannels || ["inbox"]
            },
            cycleCount: 0,
            allowedTools,
            requireApprovalForAll: true // Flag for the dynamic orchestrator to check
        };

        await db.update(missionRuns)
            .set({ missionContext: initialContext })
            .where(eq(missionRuns.id, run.id));

        // Queue the first cycle — the dynamic orchestrator will see requireApprovalForAll
        // and route through the HIL gate for every action
        await queueMissionCycle({ missionRunId: run.id, userId, orgId }, 0);
        logger.info(`[HumanDrivenOrchestrator] Launched mission run ${run.id} for mission ${missionId}`);

        return { success: true, missionRunId: run.id, missionId };
    },

    /**
     * Resume a human-driven mission after approval/rejection.
     * Called by the approval handler when the user responds.
     */
    async handleApprovalResponse(
        missionRunId: number,
        approved: boolean,
        userResponse?: string
    ) {
        const { missionRunService } = await import("./mission-run.service.js");
        const { missionService } = await import("./mission.service.js");

        const run = await missionRunService.getById(missionRunId);
        if (!run) throw new Error(`Mission run ${missionRunId} not found`);

        const context = (run.missionContext as Record<string, any>) || {};
        const pendingAction = context.pendingHumanApproval;

        if (!pendingAction) {
            logger.warn(`[HumanDrivenOrchestrator] No pending approval found for run ${missionRunId}`);
            return;
        }

        if (approved) {
            // Clear pending and mark as approved — the dynamic orchestrator will
            // execute the action on its next cycle
            await missionRunService.update(missionRunId, {
                status: "active",
                missionContext: {
                    ...context,
                    pendingHumanApproval: null,
                    lastApproval: {
                        action: pendingAction.action,
                        approved: true,
                        userNote: userResponse,
                        timestamp: new Date().toISOString()
                    },
                    // Store the approved action so the next cycle can execute it
                    approvedAction: pendingAction
                }
            });
            logger.info(`[HumanDrivenOrchestrator] Action approved for run ${missionRunId}: ${pendingAction.action}`);
        } else {
            // Rejection: clear pending, write rejection to blackboard so AI can replan
            await missionRunService.update(missionRunId, {
                status: "active",
                missionContext: {
                    ...context,
                    pendingHumanApproval: null,
                    approvedAction: null,
                    lastApproval: {
                        action: pendingAction.action,
                        approved: false,
                        rejectionReason: userResponse || "User rejected the proposed action",
                        timestamp: new Date().toISOString()
                    }
                }
            });

            if (run.missionId) {
                await missionService.updateBlackboard(run.missionId, {
                    last_human_feedback: userResponse || "Action rejected by user",
                    last_rejected_action: pendingAction.action
                }, "user:hil", "action_rejected");
            }
            logger.info(`[HumanDrivenOrchestrator] Action rejected for run ${missionRunId}: ${pendingAction.action}`);
        }

        // Re-queue the cycle to continue
        const userId = context.launchedByUserId || run.createdBy || "system";
        await queueMissionCycle({ missionRunId, userId, orgId: run.organizationId }, 1000);
    }
};
