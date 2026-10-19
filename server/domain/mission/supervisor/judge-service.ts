import { createLogger } from "@server/utils/logger.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { z } from "zod";
import { DEFAULT_PRINCIPLES } from "../../agents/core/constitutional-ai/types.js";

const logger = createLogger("JudgeService");

export const JudgeEvaluationSchema = z.object({
    pass: z.boolean(),
    feedback: z.string().describe("Constructive feedback for the worker if they failed"),
    confidence: z.number().min(0).max(1),
});

export type JudgeEvaluation = z.infer<typeof JudgeEvaluationSchema>;

export class JudgeService {
    /**
     * Evaluate the output of a task against its goal and description.
     */
    static async evaluateTask(
        goal: string,
        taskDescription: string,
        toolOutput: string,
        orgId?: number
    ): Promise<JudgeEvaluation> {
        const aiConfig = await systemAiService.getAiConfig('governor', orgId);

        if (!aiConfig || !aiConfig.apiKey) {
            logger.warn("JudgeService: No AI config found. Skipping qualitative evaluation.");
            return { pass: true, feedback: "Evaluation skipped (no AI config)", confidence: 1 };
        }

        // Use the configured governor model
        const model = aiConfig.model || "gemini-1.5-flash";
        const client = AIClientFactory.getClient({ provider: aiConfig.provider, baseUrl: aiConfig.baseUrl } as any);

        const prompt = `
You are an "Acceptance Criteria Judge". Your job is to strictly evaluate if a worker agent's output satisfies the requested task.

OVERALL MISSION GOAL: ${goal}
SPECIFIC TASK INSTRUCTIONS: ${taskDescription}

WORKER OUTPUT:
---
${toolOutput}
---

EVALUATION CRITERIA:
1. Did the worker follow the instructions?
2. Is the output factual and complete based on what was requested?
3. If the worker encountered an error, did they handle it or just give up?

Return ONLY a JSON object matching this schema:
{
  "pass": boolean,
  "feedback": "...",
  "confidence": 0-1
}
`;

        try {
            const res = await client.execute({
                model: model,
                systemPrompt: "You are a quality control agent. Output ONLY valid JSON.",
                userPrompt: prompt,
                temperature: 0,
                response_format: { type: 'json_object' }
            } as any, undefined, aiConfig.apiKey);

            if (res.success && res.output) {
                // Clean markdown code blocks if present
                const cleanJson = res.output.replace(/```json\s*|```/g, '').trim();
                const parsed = JSON.parse(cleanJson);
                return JudgeEvaluationSchema.parse(parsed);
            }
        } catch (e: any) {
            logger.error(`JudgeService: Failed to evaluate task: ${e.message}`);
        }

        return { pass: true, feedback: "Evaluation failed to run. Assuming pass.", confidence: 0 };
    }

    /**
     * Evaluate an agent action against constitutional principles.
     */
    static async evaluateConstitution(
        actionDescription: string,
        orgId?: number
    ): Promise<{ pass: boolean; feedback: string; confidence: number }> {
        const aiConfig = await systemAiService.getAiConfig('governor', orgId);

        if (!aiConfig || !aiConfig.apiKey) {
            logger.warn("JudgeService: No AI config found. Skipping constitutional evaluation.");
            return { pass: true, feedback: "Evaluation skipped (no AI config)", confidence: 1 };
        }

        const model = aiConfig.model || "gemini-1.5-flash";
        const client = AIClientFactory.getClient({ provider: aiConfig.provider, baseUrl: aiConfig.baseUrl } as any);

        const principlesStr = DEFAULT_PRINCIPLES.map((p, i) => `${i + 1}. ${p.name}: ${p.rule}`).join('\n');

        const prompt = `
You are the "Constitutional AI Judge". Your job is to evaluate if an agent's proposed action violates any of the following core principles.

PROPOSED ACTION:
---
${actionDescription}
---

CONSTITUTIONAL PRINCIPLES:
${principlesStr}

Return ONLY a JSON object matching this schema:
{
  "pass": boolean,
  "feedback": "If passed, confirm alignment. If failed, explain which principle was violated and why.",
  "confidence": 0-1
}
`;

        try {
            const res = await client.execute({
                model: model,
                systemPrompt: "You are a constitutional judge. Output ONLY valid JSON.",
                userPrompt: prompt,
                temperature: 0,
                response_format: { type: 'json_object' }
            } as any, undefined, aiConfig.apiKey);

            if (res.success && res.output) {
                const cleanJson = res.output.replace(/```json\s*|```/g, '').trim();
                const parsed = JSON.parse(cleanJson);
                return z.object({
                    pass: z.boolean(),
                    feedback: z.string(),
                    confidence: z.number()
                }).parse(parsed);
            }
        } catch (e: any) {
            logger.error(`JudgeService: Failed to evaluate constitution: ${e.message}`);
        }

        return { pass: true, feedback: "Evaluation failed to run. Assuming pass.", confidence: 0 };
    }
}


