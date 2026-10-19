import { createLogger } from "../../../utils/logger.js";
import { AIClientFactory } from "../../ai/core/ai-client.service.js";
import type { AIApiCallConfig } from "@shared/schema/index.js";

const logger = createLogger("SelfCorrectionService");

export class SelfCorrectionService {
    /**
     * Attempts to resolve corrected parameters for a failed tool execution.
     * Uses a fast LLM to generate corrected JSON parameters based on the error.
     */
    static async correct(
        apiKey: string,
        toolName: string,
        failedParams: any,
        errorMsg: string,
        goal: string
    ): Promise<Record<string, any> | null> {
        logger.info(`[Self-Correction] Analyzing failure for tool '${toolName}'...`);

        const systemPrompt = `
You are the Agent Self-Correction Assistant.
A tool execution has failed. Your goal is to analyze the failure and correct the parameters so the tool can run successfully.

TOOL NAME: ${toolName}
FAILED PARAMETERS:
${JSON.stringify(failedParams, null, 2)}

ERROR ENCOUNTERED:
${errorMsg}

MISSION OBJECTIVE:
${goal}

RESPONSE FORMAT:
You must respond with a single JSON object containing the corrected parameters. Do not include any explanation or markdown formatting (e.g. no \`\`\`json blocks). If you cannot resolve the parameters or determine how to fix the error, respond with exactly: null
`.trim();

        const config: AIApiCallConfig = {
            model: "gemini-2.0-flash", // lightweight, fast, cheap
            systemPrompt,
            userPrompt: "Analyze the error and return corrected parameters.",
            temperature: 0.1,
            useCache: false,
            saveOutputToFile: false
        };

        try {
            const aiClient = AIClientFactory.getClient({ provider: "google" } as any);
            const res = await aiClient.execute(config, undefined, apiKey);

            if (res.success && res.output) {
                const trimmed = res.output.trim();
                if (trimmed === "null") {
                    logger.warn(`[Self-Correction] Model returned null (unable to resolve).`);
                    return null;
                }
                // Strip markdown code blocks if present
                const cleanJson = trimmed.replace(/```json\n?|```/g, '').trim();
                return JSON.parse(cleanJson);
            }
        } catch (err: any) {
            logger.error(`[Self-Correction] LLM correction call failed: ${err.message}`);
        }

        return null;
    }
}
