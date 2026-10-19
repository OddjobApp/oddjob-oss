import { randomUUID } from "crypto";
import { db } from "@server/database_service.js";
import { missionRuns, skills } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { systemAiService } from "../../ai/core/system-ai.service.js";
import { createLogger } from "@server/utils/logger.js";

const MAX_TRACE_ENTRIES = 50; // Cap trace sent to AI to avoid oversized prompts

const logger = createLogger("SkillSynthesisService");

export const skillSynthesisService = {
    /**
     * Synthesizes a new skill from a successful mission run trace.
     */
    async synthesizeSkillFromMission(missionRunId: number): Promise<{ success: boolean; skillId?: number; error?: string }> {
        logger.info(`[SkillSynthesis] Attempting to synthesize skill from mission run ${missionRunId}`);

        try {
            // 1. Fetch mission run
            const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
            if (!run) {
                return { success: false, error: "Mission run not found" };
            }

            if (run.status !== "completed") {
                return { success: false, error: "Mission run is not completed" };
            }

            const trace = run.dynamicTrace as any[];
            if (!trace || trace.length === 0) {
                return { success: false, error: "No trace found for this mission run" };
            }

            // 2. Extract tool calls and sequence
            const toolCalls = trace.filter(t => t.event === "tool_called" || t.event === "tool_executed");
            if (toolCalls.length === 0) {
                return { success: false, error: "No tool calls found in trace, cannot synthesize skill." };
            }

            // Cap trace to last N entries to avoid oversized prompts
            const truncatedTrace = trace.length > MAX_TRACE_ENTRIES
                ? trace.slice(-MAX_TRACE_ENTRIES)
                : trace;

            // 3. Generate Skill using Gemini
            const prompt = `
You are an advanced AI capability synthesizer for the Oddjob platform.
Your task is to analyze a successful mission trace and synthesize a reusable "Skill" in JavaScript that encapsulates the successful pattern of tool usage or behavior.

Mission Name: ${run.name}
Mission Trace (last ${truncatedTrace.length} of ${trace.length} entries):
${JSON.stringify(truncatedTrace, null, 2)}

Please extract the core logic or sequence that led to success and encapsulate it in a reusable JavaScript block.
The code will be executed in a sandboxed environment where it has access to:
- \`args\`: The input arguments passed to the skill.
- \`console.log\`: For logging.
- \`Math\`, \`JSON\`, \`Date\`.
- \`temporal\`: Helper functions for date calculations.

CRITICAL: You MUST assign the final result of the skill to the global variable \`result\`.
Example: \`result = { status: "success", data: ... };\`

Return a JSON object matching this structure:
{
    "name": "UPPER_SNAKE_CASE_NAME",
    "description": "Clear description of what this skill does",
    "language": "javascript",
    "code": "The actual source code. Remember to assign the final output to the 'result' variable!"
}
`;

            const result = await systemAiService.generateJson(prompt, 'architect') as any;

            if (!result || !result.name || !result.code) {
                return { success: false, error: "Failed to generate a valid skill from AI." };
            }

            // Ensure name uniqueness with a cryptographic suffix and sanitize
            const sanitizedName = result.name.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
            const skillName = `${sanitizedName}_${randomUUID().slice(0, 8)}`;
            logger.info(`[SkillSynthesis] Synthesized skill: ${skillName}`);

            // 4. Save to database
            const [newSkill] = await db.insert(skills).values({
                name: skillName,
                description: result.description,
                language: result.language || "javascript",
                code: result.code,
                isPublic: false, // Requires explicit review before publishing
                organizationId: run.organizationId,
                metadata: {
                    synthesizedFromRunId: missionRunId,
                    traceLength: trace.length,
                    toolsUsed: toolCalls.map(t => t.tool)
                }
            }).returning();

            return { success: true, skillId: newSkill.id };

        } catch (error: any) {
            logger.error(`[SkillSynthesis] Error synthesizing skill: ${error.message}`);
            return { success: false, error: error.message };
        }
    }
};
