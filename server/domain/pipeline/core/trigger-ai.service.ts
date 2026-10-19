import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("TriggerAIService");

export interface TriggerTranslationResult {
    success: boolean;
    condition: string | null;
    reasoning: string;
    error?: string;
}

/**
 * Trigger AI Service
 * 
 * Handles natural language translation for pipeline and mission triggers.
 */
export const triggerAiService = {
    /**
     * Translates a natural language description into a valid Oddjob Trigger Condition.
     * 
     * Supported format: event.<field> <op> <value>
     * Example: "When order value is over 100" -> "event.payload.value > 100"
     */
    async translateNaturalLanguage(prompt: string, context?: any): Promise<TriggerTranslationResult> {
        logger.info(`[TriggerAI] Translating: "${prompt}"`);

        const systemPrompt = `
            You are the Oddjob Strategic Sentinel. Your task is to translate a user's natural language requirement into a technical trigger condition.
            
            TECHNICAL SPECIFICATION:
            - Conditions MUST follow the pattern: event.<path> <operator> <value>
            - Operators allowed: ===, !==, ==, !=, >=, <=, >, <
            - Event path starts with "event." and usually targets "event.payload.<field>"
            - Values should be strings (quoted), numbers, or booleans.
            
            USER INPUT:
            "${prompt}"
            
            CONTEXT (Event Schema/Recent Events):
            ${JSON.stringify(context || {}, null, 2)}
            
            OUTPUT:
            Return a JSON object with:
            {
                "condition": "event.payload.amount > 100",
                "reasoning": "Mapped 'order value' to 'event.payload.amount' and 'over' to '>'.",
                "confidence": 0.95
            }
        `;

        try {
            const result = await systemAiService.generateJson(systemPrompt, 'copilot');
            
            if (!result || !result.condition) {
                return {
                    success: false,
                    condition: null,
                    reasoning: "AI failed to generate a valid condition.",
                    error: "Invalid AI response"
                };
            }

            return {
                success: true,
                condition: result.condition,
                reasoning: result.reasoning
            };
        } catch (err: any) {
            logger.error(`[TriggerAI] Translation error: ${err.message}`);
            return {
                success: false,
                condition: null,
                reasoning: "A system error occurred during translation.",
                error: err.message
            };
        }
    }
};
