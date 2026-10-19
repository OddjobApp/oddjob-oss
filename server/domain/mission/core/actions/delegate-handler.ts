import { ActionHandler, ActionContext, DelegateDecision } from "./action-handler.js";
import { createLogger } from "@server/utils/logger.js";
import { missionService } from "../mission.service.js";
import { missionExecutionService } from "../mission-execution.service.js";
import { queueMissionCycle } from "../../infrastructure/dynamic-mission-queue.js";

const logger = createLogger("DelegateHandler");

export class DelegateHandler implements ActionHandler {
    async execute(ctx: ActionContext, decision: DelegateDecision): Promise<void> {
        const { missionRunId, missionId, missionContext, userId, orgId, appendTrace, trackAsset } = ctx;

        if (!orgId) throw new Error("Missing org context for DELEGATE action.");

        // Unified delegation: uses missionExecutionService.launchMission (queued, non-blocking)
        const delegatedTask = decision.action_details?.task_description;
        const delegatedTools: string[] = decision.action_details?.allowed_tools || missionContext?.allowedTools || [];
        const delegatedAgent: string | undefined = decision.action_details?.agent_name;

        await appendTrace(missionRunId, {
            type: "system",
            event: "task_delegating",
            note: `Launching async sub-mission for: "${delegatedTask}"${delegatedAgent ? ` (agent: ${delegatedAgent})` : ""}`,
            timestamp: new Date().toISOString()
        });

        try {
            const delegateMission = await missionService.createMission({
                name: `[Sub-Task] ${String(delegatedTask || "delegated").slice(0, 60)}`,
                objective: delegatedTask,
                organizationId: orgId,
                executionStrategy: "dynamic_autonomous",
                status: "active",
                blackboard: {
                    parentMissionRunId: missionRunId,
                    parentMissionId: missionId,
                    allowedTools: delegatedTools,
                    isSubTask: true
                }
            }, userId);

            const delegateLaunch = await missionExecutionService.launchMission(
                delegateMission.id, userId, orgId, undefined, missionRunId
            );

            if (delegateLaunch.success && delegateLaunch.missionRunId) {
                await missionService.updateBlackboard(
                    missionId,
                    {
                        [`delegation_run_${Date.now()}`]: { childMissionId: delegateMission.id, childRunId: delegateLaunch.missionRunId, task: delegatedTask, status: "active" },
                        last_tool_run: "DELEGATE",
                        last_tool_status: "launched"
                    },
                    "agent:orchestrator",
                    "delegation_launched"
                );
                await trackAsset(missionRunId, { type: 'delegation', id: delegateMission.id, description: delegatedTask });
                await appendTrace(missionRunId, {
                    type: "system",
                    event: "task_delegate_launched",
                    note: `Sub-mission ${delegateMission.id} (run ${delegateLaunch.missionRunId}) launched asynchronously.`,
                    timestamp: new Date().toISOString()
                });
            } else {
                throw new Error(delegateLaunch.error || "Sub-mission launch failed");
            }
        } catch (delegateErr: any) {
            logger.error(`[DelegateHandler] Delegation failed: ${delegateErr.message}`);
            await missionService.updateBlackboard(
                missionId,
                { last_tool_error: `Delegation failed: ${delegateErr.message}`, last_tool_status: "failed" },
                "agent:orchestrator",
                "delegation_error"
            );
            await appendTrace(missionRunId, {
                type: "error",
                event: "task_delegate_failed",
                error: delegateErr.message,
                timestamp: new Date().toISOString()
            });
        }

        // Enqueue next cycle — parent continues; AI will see child status on blackboard
        await queueMissionCycle({ missionRunId, userId, orgId }, 3000);
    }
}
