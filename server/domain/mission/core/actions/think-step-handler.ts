import { ActionHandler, ActionContext, BaseDecision } from "./action-handler.js";
import { queueMissionCycle } from "../../infrastructure/dynamic-mission-queue.js";

export class ThinkStepHandler implements ActionHandler {
    async execute(ctx: ActionContext, decision: BaseDecision): Promise<void> {
        const { missionRunId, userId, orgId } = ctx;

        // Reasoning already captured in audit and decision.thought_process
        // Just enqueue next cycle to continue thinking/acting
        await queueMissionCycle({ missionRunId, userId, orgId }, 2000);
    }
}
