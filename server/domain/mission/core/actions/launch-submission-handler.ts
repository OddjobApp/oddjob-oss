import { ActionHandler, ActionContext, LaunchSubmissionDecision } from "./action-handler.js";
import { createLogger } from "@server/utils/logger.js";
import { missionService } from "../mission.service.js";
import { missionExecutionService } from "../mission-execution.service.js";

const logger = createLogger("LaunchSubmissionHandler");

export class LaunchSubmissionHandler implements ActionHandler {
    async execute(ctx: ActionContext, decision: LaunchSubmissionDecision): Promise<void> {
        const { missionRunId, missionId, missionContext, userId, orgId, appendTrace } = ctx;

        const subMissionName = decision.action_details?.mission_name || `Sub-mission for Run ${missionRunId}`;
        const subObjective = decision.action_details?.objective || decision.thought_process || "Execute specialized tasks.";
        
        logger.info(`[LaunchSubmissionHandler] Run ${missionRunId} launching sub-mission: ${subMissionName}`);

        // Create a new mission container for this sub-mission
        const subMission = await missionService.createMission({
            name: subMissionName,
            objective: subObjective,
            organizationId: orgId,
            executionStrategy: "dynamic_autonomous", // Inherit dynamic autonomy
            status: "active"
        }, userId);

        // Launch the mission run linked to this parent
        const launchResult = await missionExecutionService.launchMission(
            subMission.id, 
            userId, 
            orgId, 
            undefined, 
            missionRunId // Passing parentId
        );

        if (launchResult.success && launchResult.missionRunId) {
            const childRunId = launchResult.missionRunId;
            
            // Save sub-mission link to parent blackboard
            const subMissionsKey = "active_sub_missions";
            const currentSubMissions = (missionContext as any)?.[subMissionsKey] || [];
            const updatedSubMissions = [...currentSubMissions, { runId: childRunId, name: subMissionName, status: "active" }];
            
            await missionService.updateBlackboard(missionId, {
                [subMissionsKey]: updatedSubMissions,
                last_sub_mission_launched: childRunId
            }, "agent:orchestrator", `launched_sub_mission:${childRunId}`);

            await appendTrace(missionRunId, { 
                type: "system", 
                event: "sub_mission_launched", 
                note: `Launched sub-mission '${subMissionName}' (Run: ${childRunId}) to handle: ${subObjective}`, 
                timestamp: new Date().toISOString() 
            });
        } else {
            throw new Error(`Failed to launch sub-mission: ${launchResult.error || "Unknown error"}`);
        }
    }
}
