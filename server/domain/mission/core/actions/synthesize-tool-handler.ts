import { ActionHandler, ActionContext, SynthesizeToolDecision } from "./action-handler.js";
import { db } from "@server/database_service.js";
import { missionMembers } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import { decisionRouter } from "../../../governor/core/decision-router.js";
import { missionService } from "../mission.service.js";

const logger = createLogger("SynthesizeToolHandler");

export class SynthesizeToolHandler implements ActionHandler {
    async execute(ctx: ActionContext, decision: SynthesizeToolDecision): Promise<void> {
        const { missionRunId, missionId, missionContext, userId, orgId, appendTrace } = ctx;

        const newTool = decision.action_details?.new_tool;
        const synthRationale = decision.thought_process || "Filling a technical capability gap.";

        if (!newTool || !newTool.code || !newTool.name) {
            throw new Error("Missing 'new_tool' details (name, code, language) for SYNTHESIZE_TOOL action.");
        }

        logger.info(`[SynthesizeToolHandler] Run ${missionRunId} proposing tool synthesis: ${newTool.name}`);

        // 1. Request HIL Approval for Synthesis (High Risk - AI Generated Code)
        const synthesisProposal = await decisionRouter.requestDecision({
            sessionId: `synth-${newTool.name}`,
            executionId: String(missionRunId),
            tool: "SYNTHESIZE_TOOL",
            params: { name: newTool.name, language: newTool.language, code: newTool.code },
            goal: `Synthesize a new '${newTool.language}' capability specialists to perform: ${newTool.description}`,
            description: `RATIONALE: ${synthRationale}\n\nWARNING: This will execute AI-generated code in a sandboxed environment.`,
            riskLevel: "high", 
            approverType: "internal",
            approverId: userId,
            channels: ["inbox", "copilot"],
            noWait: true, // Non-blocking synthesis proposal
        });

        if (synthesisProposal.approved) {
            const { skillService } = await import("../../../agents/core/skill-service.js");

            // Create the underlying Skill
            const skill = await skillService.createSkill({
                name: newTool.name,
                description: newTool.description,
                code: newTool.code,
                language: newTool.language || "javascript",
                isPublic: true,
                organizationId: orgId
            });

            // Provision the specialist Agent (Job)
            const job = await skillService.provisionAgentFromSkill(skill.id, orgId!, parseInt(userId));

            // Inject as a member into THIS mission immediately
            await db.insert(missionMembers).values({
                missionId: missionId,
                entityType: "job",
                entityId: job.id,
                role: "specialist",
                status: "active"
            });

            // Add to allowedTools in current context so the orchestrator can call it next cycle
            const currentAllowed = missionContext?.allowedTools || [];
            const updatedAllowed = [...new Set([...currentAllowed, newTool.name])];
            
            await missionService.updateBlackboard(missionId, {
                allowedTools: updatedAllowed,
                [`synthesized_specialist_${newTool.name}`]: job.id
            }, "agent:orchestrator", "synthesis_success");

            await appendTrace(missionRunId, { 
                type: "system", 
                event: "tool_synthesized", 
                note: `NEW CAPABILITY SYNTHESIZED: '${newTool.name}' (Specialist Job: ${job.id}). The orchestrator can now delegate specialized tasks to this agent.`, 
                timestamp: new Date().toISOString() 
            });
        } else {
            await appendTrace(missionRunId, { 
                type: "system", 
                event: "synthesis_rejected", 
                note: `User rejected the tool synthesis proposal for '${newTool.name}'.`, 
                timestamp: new Date().toISOString() 
            });
        }
    }
}
