import { ExecutionHook, HookParams, PipelineCompleteParams } from "./execution-hooks.js";
import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { knowledgeService } from "@domain/knowledge/core/knowledge.service.js";
import { db } from "@server/database_service.js";
import { missionRuns, missions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { OKFSerializer } from "@domain/knowledge/core/okf-serializer.js";

const logger = createLogger("GoldenPathHook");

export class GoldenPathHook implements ExecutionHook {
    name = "GoldenPathHook";

    async onPipelineComplete(params: PipelineCompleteParams) {
        // Fire-and-forget to avoid blocking pipeline completion
        this.generateGoldenPathAsync(params).catch(err => {
            logger.error(`Failed to generate Golden Path for missionRunId: ${params.pipelineExecution?.missionRunId}`, { error: err });
        });
    }

    private async generateGoldenPathAsync(params: PipelineCompleteParams) {
        const { pipelineExecution, orgId, userId } = params;
        const missionRunId = pipelineExecution?.missionRunId;

        if (!missionRunId) {
            return;
        }

        // 1. Fetch the mission run
        const [run] = await db
            .select()
            .from(missionRuns)
            .where(eq(missionRuns.id, missionRunId))
            .limit(1);

        if (!run) {
            logger.warn(`MissionRun ${missionRunId} not found.`);
            return;
        }

        if (!run.isSuccess) {
            logger.debug(`MissionRun ${missionRunId} was not successful. Skipping Golden Path generation.`);
            return;
        }

        if (!run.dynamicTrace || (Array.isArray(run.dynamicTrace) && run.dynamicTrace.length === 0)) {
            logger.debug(`MissionRun ${missionRunId} has no dynamic trace. Skipping Golden Path generation.`);
            return;
        }

        // Fetch parent mission to get name
        const [mission] = await db
            .select()
            .from(missions)
            .where(eq(missions.id, run.missionId!))
            .limit(1);

        const missionName = mission?.name || run.name || `Mission ${run.missionId}`;

        logger.info(`Starting asynchronous Golden Path generation for MissionRun ${missionRunId} (${missionName})...`);

        // 2. Synthesize SOP using LLM
        const prompt = `You are a Principal AI Agent Architect at Oddjob. 
You are analyzing a highly successful agentic mission trace. 
Your goal is to extract the exact methodology the agent used to succeed and codify it into a Standard Operating Procedure (SOP).
This SOP will be saved as a "Golden Path" for future agents to follow.

Mission Name: ${missionName}
Mission Run ID: ${run.id}

Mission Trace (JSON):
${JSON.stringify(run.dynamicTrace, null, 2)}

Requirements:
1. Format your response strictly as a Markdown document.
2. Do not include YAML frontmatter, as it will be generated automatically.
3. Start with a brief high-level summary of the mission objective and strategy.
4. Provide a numbered list of concrete steps taken to achieve the goal.
5. Highlight any specific API calls, search parameters, or constraints that were key to success.
6. Make it deterministic and actionable.`;

        const sopMarkdown = await systemAiService.generateText(prompt, { 
            serviceKey: "architect", 
            temperature: 0.2 // Low temperature for factual extraction
        });

        if (!sopMarkdown) {
            throw new Error(`Failed to generate text from AI service.`);
        }

        // 3. Serialize to OKF format (as plain markdown body)
        // We inject the frontmatter using OKFSerializer so it conforms to standard
        const okfContent = OKFSerializer.serialize({
            title: `SOP: ${missionName}`,
            textContent: sopMarkdown,
            metadata: {
                sourceType: 'golden_path',
                type: 'sop',
                missionRunId: run.id,
                missionId: run.missionId,
            }
        });

        // 4. Save to Knowledge Graph
        const orgContext = {
            organizationId: orgId,
            userId: userId || 'system',
            isAdmin: false,
            isSuperAdmin: false,
            isOrgAdmin: false
        };

        const document = await knowledgeService.createDocument({
            title: `SOP: ${missionName}`,
            summary: `Auto-generated Standard Operating Procedure extracted from successful mission run ${run.id}.`,
            sourceType: 'golden_path',
            textContent: okfContent,
            contentType: 'text/markdown',
            metadata: {
                missionRunId: run.id,
                missionId: run.missionId
            },
            // We could optionally assign a specific topic ID here if we had a "Golden Paths" topic
        }, orgContext as any);

        logger.info(`Successfully generated Golden Path KnowledgeDocument ${document.id} for MissionRun ${run.id}`);
    }
}
