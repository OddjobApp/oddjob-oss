
import { db } from "@server/database_service.js";
import { agentRunSteps } from "@shared/schema/index.js";
import { randomUUID } from "crypto";
import { resolveOrgGeminiKey } from "@domain/ai/core/org-gemini-key.js";

export interface AgentStep {
    type: string;
    content: string;
    toolName?: string | null;
    toolArgs?: any;
    observation?: string;
    thoughts?: string;
    confidence?: number;
    /**
     * Structured detail for the step, stored in `agent_run_steps.metadata`.
     * Carries the terminal metrics on a `run_outcome` step — see
     * AgentOrchestrator.run(), which files exactly one per run.
     */
    metadata?: Record<string, unknown>;
}

export async function persistAgentHistory(
    history: AgentStep[],
    context: {
        jobId?: number | null;
        userId?: string;
        organizationId?: number | null;
        missionId?: number | null;
    }
) {
    if (!history || history.length === 0) return;

    try {
        const runId = randomUUID();
        const stepsToInsert = history.map(step => {
            let toolName = step.toolName || null;
            let toolArgs = step.toolArgs || null;

            // Improved parsing if type is 'action' or 'thought' with JSON
            if (step.type === 'action' || (step.type === 'thought' && !toolName)) {
                try {
                    const content = step.content;
                    
                    // Try direct parse first
                    let parsed: any = null;
                    if (content.trim().startsWith('{')) {
                        try { parsed = JSON.parse(content); } catch (e) { }
                    }

                    // Try extracting from markdown blocks if direct parse failed
                    if (!parsed) {
                        const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
                        if (jsonMatch) {
                            try { parsed = JSON.parse(jsonMatch[1]); } catch (e) { }
                        }
                    }

                    // Try linear scan for braces if still nothing
                    if (!parsed) {
                        const first = content.indexOf('{');
                        const last = content.lastIndexOf('}');
                        if (first !== -1 && last !== -1 && last > first) {
                            try { parsed = JSON.parse(content.substring(first, last + 1)); } catch (e) { }
                        }
                    }

                    if (parsed) {
                        toolName = toolName || parsed.tool || parsed.action || parsed.tool_call || parsed.function || parsed.name;
                        toolArgs = toolArgs || parsed.params || parsed.parameters || parsed.args || parsed.input;
                    }
                } catch (e) { /* ignore */ }
            }

            return {
                runId: runId,
                jobId: context.jobId || null,
                organizationId: context.organizationId || null,
                userId: context.userId || 'system',
                type: step.type,
                content: step.content,
                toolName: toolName,
                toolArgs: toolArgs,
                missionId: context.missionId || null,
                confidence: step.confidence ?? null,
                metadata: step.metadata ?? {},
            };
        });

        if (stepsToInsert.length > 0) {
            await db.insert(agentRunSteps).values(stepsToInsert);
        }
    } catch (e) {
        console.error("[Agent Persistence] Failed to save agent run steps:", e);
    }
}

/**
 * Summarizes the successful history and saves it as a reusable skill/retrospective.
 */
export async function saveSuccessfulPlanAsSkill(
    history: any[],
    context: { missionId: number | null; organizationId: number; goal: string }
) {
    try {
        const { missionRetrospectives } = await import("@shared/schema/missions/index.js");
        const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");
        
        // Extract successful steps and logic
        const logicSteps = history
            .filter(h => h.type === 'action' || h.type === 'thought')
            .map(h => h.content)
            .join("\n");

        // Use a small LLM to distill this into a "Macro Skill"
        const client = AIClientFactory.getClient({ provider: "google" } as any);
        const apiKey = await resolveOrgGeminiKey(context.organizationId);
        if (!apiKey) return;

        const distillationPrompt = `
Analyze this successful agent execution trace for the goal: "${context.goal}"
Distill it into a "Reusable Skill Template".
Include:
1. Exact tool sequence.
2. Logic gates (if/then patterns discovered).
3. Data requirements.

Successful Trace:
${logicSteps.substring(0, 5000)}
`;

        // const { AIApiCallConfig } = await import("@shared/schema/index.js");
        const distillationConfig: any = {
            model: "gemini-1.5-flash",
            userPrompt: distillationPrompt,
            systemPrompt: "You are a skill extraction engine. Distill execution traces into reusable patterns.",
            temperature: 0,
            credentialId: 1 // Dummy for type safety
        };

        const result = await client.execute(distillationConfig as any, undefined, apiKey);

        if (result.success && result.output) {
            const skillText = String(result.output);
            const { embeddingService } = await import("../../knowledge/core/rag/embedding-service.js");
            const embeddingResult = await embeddingService.generateEmbedding(`${context.goal}\n${skillText}`);
            const embeddingStr = embeddingResult ? JSON.stringify(embeddingResult) : null;

            // Store as a retrospective/learned context
            await db.insert(missionRetrospectives).values({
                missionRunId: -1, // Template/Global level
                successScore: 100,
                learnedContext: result.output as any,
                analyzedBy: "skill-extractor",
                organizationId: context.organizationId,
                missionId: context.missionId,
                embedding: embeddingStr
            } as any);
            console.log(`[Agent Persistence] Reusable skill extracted, vectorized, and saved for mission ${context.missionId}`);
        }
    } catch (e) {
        console.error("[Agent Persistence] Skill extraction failed:", e);
    }
}


