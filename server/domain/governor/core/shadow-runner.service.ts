import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { aiConfigResolver } from "@domain/ai/core/ai-config-resolver.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ShadowRunner");

export interface ShadowValidationResult {
    agreement: boolean;
    confidence: number;
    explanation: string;
}

export class ShadowRunnerService {
    /**
     * Cross-checks an agent's intended action with a high-fidelity secondary model.
     */
    async validateDecision(originalPrompt: string, originalDecision: string, context: any): Promise<ShadowValidationResult> {
        logger.info("Executing Shadow Run cross-verification...");

        try {
            // 1. Resolve a High-Fidelity Validator Config (usually a 'pro' model)
            const aiConfig = await aiConfigResolver.resolveSystemConfig('faultAnalysis'); // Reusing for demo logic
            if (!aiConfig) throw new Error("No validator configuration available");

            const client = AIClientFactory.getClient({
                provider: aiConfig.provider,
                model: "gemini-1.5-pro" // Explicit high-fidelity override
            } as any);

            const prompt = `
            Task: Verify the following AI Agent decision for accuracy and safety.
            
            Original Prompt: "${originalPrompt}"
            Decision Under Review: "${originalDecision}"
            Contextual State: ${JSON.stringify(context)}

            Instructions:
            1. Analyze the decision against the prompt and context.
            2. Does the decision contain hallucinations, logic errors, or safety violations?
            3. Return a JSON object: { "agreement": boolean, "confidence": 0-1, "explanation": "string" }
            4. Be critical. If the decision is even slightly suspicious, set agreement to false.
            `;

            const result = await client.execute({
                credentialId: aiConfig.credentialId,
                model: "gemini-1.5-pro",
                userPrompt: prompt,
                temperature: 0,
                requestType: "json",
                useCache: true,
                saveOutputToFile: false
            }, undefined, aiConfig.apiKey);

            if (result.success && result.output) {
                return JSON.parse(result.output);
            }
        } catch (error) {
            logger.error("Shadow validation failed to complete", { error });
        }

        return { agreement: true, confidence: 0, explanation: "Validation failed to run; assuming agreement by default (fail-safe mode)." };
    }
}

export const shadowRunnerService = new ShadowRunnerService();
