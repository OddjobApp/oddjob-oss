
import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "../../ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { db } from "@server/database_service.js";
import { missionRuns } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

const logger = createLogger("MissionDebateService");

export const DEBATE_PROMPT = `
You are the "Moderator" of a multi-agent debate for an autonomous mission.
The goal is to refine the proposed mission blueprint through debate between two specialized perspectives.

THE CREW:
1. **The Researcher (Pragmatist)**: Focuses on data availability, tool reliability, and external constraints.
2. **The Architect (Visionary)**: Focuses on efficiency, strategic alignment, and long-term goal completion.

GOAL: {{goal}}
PROPOSED BLUEPRINT: {{blueprint}}

INSTRUCTIONS:
1. Simulate a 3-turn debate.
2. **Turn 1 (Critique)**: The Researcher identifies potential flaws or missing data sources in the blueprint.
3. **Turn 2 (Counter-Proposal)**: The Architect defends the plan or proposes a structural optimization.
4. **Turn 3 (Consensus)**: You, as the Moderator, synthesize the debate into a REFINED BLUEPRINT.

REFINED BLUEPRINT REQUIREMENTS:
- Must follow the same JSON schema as the original blueprint.
- Must include a 'debate_summary' field in the 'thought_process' or as a top-level field.
- Must ensure all tool calls are valid and necessary.

Output ONLY the refined JSON blueprint.
`;

export class MissionDebateService {
    static async debate(missionRunId: number, blueprint: any, orgId: number | null, appendTrace: (id: number, entry: any) => void): Promise<any> {
        logger.info(`[Phase 2] Starting Multi-Agent Consensus Debate for Run ${missionRunId}`);
        
        const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
        if (!run) throw new Error("Run not found");

        const aiConfig = await systemAiService.getAiConfig('copilot', orgId ?? undefined);
        if (!aiConfig) throw new Error("AI Configuration missing");

        const client = AIClientFactory.getClient(aiConfig as any);
        
        appendTrace(missionRunId, { type: "system", event: "debate_started", note: "Entering the War Room. Agents are debating the strategy..." });

        const prompt = DEBATE_PROMPT
            .replace("{{goal}}", run.name)
            .replace("{{blueprint}}", JSON.stringify(blueprint, null, 2));

        const result = await client.execute({
            model: aiConfig.model,
            systemPrompt: "You are the Debate Moderator. Synthesize multiple agent perspectives into a final mission blueprint. Output ONLY valid JSON.",
            userPrompt: prompt,
            requestType: "json"
        } as any, undefined, aiConfig.apiKey ?? "");

        if (!result.success || !result.output) {
            logger.warn(`[Debate] Consensus failed: ${result.error}. Proceeding with original blueprint.`);
            appendTrace(missionRunId, { type: "system", event: "debate_failed", note: "Consensus could not be reached. Falling back to original plan." });
            return blueprint;
        }

        try {
            const refinedBlueprint = typeof result.output === 'string' ? JSON.parse(result.output.replace(/```json/g, '').replace(/```/g, '').trim()) : result.output;
            
            appendTrace(missionRunId, { 
                type: "strategist", 
                event: "consensus_reached", 
                note: refinedBlueprint.thought_process?.debate_summary || "Debate complete. Strategy refined for maximum alignment." 
            });

            return refinedBlueprint;
        } catch (err) {
            logger.error(`[Debate] Failed to parse refined blueprint: ${err}`);
            return blueprint;
        }
    }
}
