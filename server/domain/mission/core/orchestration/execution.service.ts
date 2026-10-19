
import { db } from "@server/database_service.js";
import { missions, missionRuns, jobs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { AGENT_TOOLS, normalizeToolName, normalizeToolArguments } from "../../../tools/v1/tool-registry.service.js";
import { handleToolCall } from "../../../../mcp/handlers.js";
import { missionRunService } from "../mission-run.service.js";
import { skillService } from "../../../agents/core/skill-service.js";
import { OrchestrationContext, OrchestrationThought } from "./types.js";

const logger = createLogger("OrchestrationExecution");

export const orchestrationExecutionService = {
    async executeAction(ctx: OrchestrationContext, thought: OrchestrationThought): Promise<{ success: boolean; result?: any; error?: string; concluded?: boolean }> {
        const { missionRunId, blackboard, orgId, userId } = ctx;
        const { action, params } = thought;

        if (action === 'conclude_mission') {
            return { success: true, concluded: true, result: params.result || "Objective achieved." };
        }

        // 1. Resolve Tool Name
        const toolName = normalizeToolName(action);
        const tool = AGENT_TOOLS[toolName];

        if (!tool && action !== 'think_step') {
            // Check if it's a dynamic skill
            try {
                const skill = await skillService.getSkillByName(action);
                if (skill) {
                    const skillResult = await skillService.executeSkill(skill.id, params as any);
                    if (skillResult) {
                        await (orchestrationExecutionService as any).updateBlackboard(missionRunId, blackboard, action, skillResult);
                        return { success: true, result: skillResult };
                    }
                }
            } catch (err: any) {
                logger.warn(`Skill execution failed for ${action}`, { error: err.message });
            }
            return { success: false, error: `Tool or skill '${action}' not found.` };
        }

        if (action === 'think_step') {
            return { success: true, result: "Reasoning updated." };
        }

        // 2. Execute MCP/Core Tool
        try {
            const normalizedParams = normalizeToolArguments(toolName, params);
            const toolResult = await handleToolCall(toolName, normalizedParams, {
                missionRunId,
                missionId: ctx.missionId, // Pass missionId for collaboration tools
                organizationId: orgId ?? undefined,
                userId,
                named: {},
                positional: {}
            } as any);

            // 3. Update Blackboard
            await this.updateBlackboard(missionRunId, blackboard, toolName, toolResult);
            
            return { success: true, result: toolResult };
        } catch (err: any) {
            logger.error(`Tool execution failed: ${toolName}`, err);
            return { success: false, error: err.message };
        }
    },

    async updateBlackboard(missionRunId: number, currentBlackboard: any, toolName: string, result: any) {
        const key = `tool_output_${toolName}_${Date.now()}`;
        const updatedBlackboard = {
            ...currentBlackboard,
            [key]: result,
            last_tool: toolName,
            last_output_key: key
        };

        await missionRunService.update(missionRunId, {
            missionContext: updatedBlackboard // This is a bit simplified, but follows the pattern
        });
    }
};
