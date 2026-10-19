/**
 * Failed Trace Hook
 *
 * Mirror of GoldenPathHook for unsuccessful mission runs.
 * Captures structured failure traces as KnowledgeDocuments with
 * sourceType = 'failed_trace', providing the negative examples
 * needed for contrastive learning in the DSPy optimizer and
 * Golden Path retrieval (negative filtering).
 *
 * Paired together, golden_path + failed_trace documents enable
 * the same contrastive extraction that activation steering
 * performs on model internals — but at the prompt layer.
 */

import { ExecutionHook, PipelineCompleteParams } from "./execution-hooks.js";
import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { knowledgeService } from "@domain/knowledge/core/knowledge.service.js";
import { db } from "@server/database_service.js";
import { missionRuns, missions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { OKFSerializer } from "@domain/knowledge/core/okf-serializer.js";

const logger = createLogger("FailedTraceHook");

export class FailedTraceHook implements ExecutionHook {
    name = "FailedTraceHook";

    async onPipelineComplete(params: PipelineCompleteParams) {
        // Fire-and-forget to avoid blocking pipeline completion
        this.captureFailedTraceAsync(params).catch(err => {
            logger.error(`Failed to capture failed trace for missionRunId: ${params.pipelineExecution?.missionRunId}`, { error: err });
        });
    }

    private async captureFailedTraceAsync(params: PipelineCompleteParams) {
        const { pipelineExecution, orgId, userId } = params;
        const missionRunId = pipelineExecution?.missionRunId;

        if (!missionRunId) return;

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

        // Only process failed or explicitly unsuccessful runs
        if (run.isSuccess) {
            logger.debug(`MissionRun ${missionRunId} was successful. FailedTraceHook skipping.`);
            return;
        }

        if (!run.dynamicTrace || (Array.isArray(run.dynamicTrace) && run.dynamicTrace.length === 0)) {
            logger.debug(`MissionRun ${missionRunId} has no dynamic trace. Skipping failed trace capture.`);
            return;
        }

        // Fetch parent mission name
        const [mission] = await db
            .select()
            .from(missions)
            .where(eq(missions.id, run.missionId!))
            .limit(1);

        const missionName = mission?.name || run.name || `Mission ${run.missionId}`;

        logger.info(`Capturing failed trace for MissionRun ${missionRunId} (${missionName})...`);

        // 2. Synthesize failure analysis using LLM
        const prompt = `You are a Principal AI Agent Architect at Oddjob performing a post-mortem analysis.
You are analyzing a failed agentic mission trace to identify what went wrong and how to avoid this failure in the future.
This analysis will be saved as a "Failed Trace" — a negative example that teaches future agents what NOT to do.

Mission Name: ${missionName}
Mission Run ID: ${run.id}
Failure Reason: ${run.failureReason || 'Unknown'}

Mission Trace (JSON):
${JSON.stringify(run.dynamicTrace, null, 2)}

Requirements:
1. Format your response strictly as a Markdown document.
2. Do not include YAML frontmatter, as it will be generated automatically.
3. Start with a brief summary of what the mission was trying to achieve and why it failed.
4. Identify the specific decision point(s) where execution deviated from a successful path.
5. List concrete anti-patterns observed (what the agent did wrong).
6. Suggest the corrective actions that should have been taken instead.
7. Make it specific, actionable, and deterministic — not generic advice.`;

        const failureAnalysis = await systemAiService.generateText(prompt, {
            serviceKey: "architect",
            temperature: 0.2
        });

        if (!failureAnalysis) {
            throw new Error(`Failed to generate failure analysis from AI service.`);
        }

        // 3. Serialize to OKF format
        const okfContent = OKFSerializer.serialize({
            title: `FAILED TRACE: ${missionName}`,
            textContent: failureAnalysis,
            metadata: {
                sourceType: 'failed_trace',
                type: 'failure_analysis',
                missionRunId: run.id,
                missionId: run.missionId,
                failureReason: run.failureReason,
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
            title: `FAILED TRACE: ${missionName}`,
            summary: `Auto-generated failure analysis extracted from failed mission run ${run.id}. Used as a negative example for contrastive learning.`,
            sourceType: 'failed_trace',
            textContent: okfContent,
            contentType: 'text/markdown',
            metadata: {
                missionRunId: run.id,
                missionId: run.missionId,
                failureReason: run.failureReason,
            },
        }, orgContext as any);

        logger.info(`Successfully captured Failed Trace KnowledgeDocument ${document.id} for MissionRun ${run.id}`);
    }
}
