import { ActionHandler, ActionContext, HilRequestDecision } from "./action-handler.js";
import { db } from "@server/database_service.js";
import { missionRuns } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { approvalService } from "../../../integrations/core/approval.service.js";
import { missionRunService } from "../mission-run.service.js";

const logger = createLogger("HilRequestHandler");

export class HilRequestHandler implements ActionHandler {
    async execute(ctx: ActionContext, decision: HilRequestDecision): Promise<void> {
                const { missionRunId, missionContext, blackboard, userId, orgId, effectiveUserEmail, appendTrace } = ctx;

        const hilQuestion = decision.action_details?.question || decision.thought_process || "Awaiting input.";
        
        // Create the actual approval request so it shows up in Decision Inbox
        const approvalRequest = await approvalService.createApprovalRequest({
            executionId: String(missionRunId),
            jobId: 1, // Default supervisor job ID
            approverType: "user",
            approverId: userId,
            approverEmail: effectiveUserEmail,
            status: "pending",
            organizationId: orgId || undefined,
            context: {
                dynamicAction: decision,
                blackboard: { ...((missionContext as any) || {}), ...((blackboard as any) || {}) }
            }
        });

        await missionRunService.update(missionRunId, { 
            status: "waiting_on_human",
            missionContext: {
                ...(missionContext as any || {}),
                resumeCondition: {
                    type: "human_approval",
                    approvalRequestIds: [approvalRequest.id]
                }
            }
        });
        
        // Also update the missionRun row directly for the resume search logic
        await db.update(missionRuns)
            .set({ 
                resumeCondition: {
                    type: "human_approval",
                    approvalRequestIds: [approvalRequest.id]
                } 
            })
            .where(eq(missionRuns.id, missionRunId));

        await appendTrace(missionRunId, { 
            type: "system", 
            event: "hil_requested", 
            note: hilQuestion, 
            timestamp: new Date().toISOString() 
        });
    }
}
