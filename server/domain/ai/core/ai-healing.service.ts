import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { createLogger } from "@server/utils/logger.js";
import { aiConfigResolver } from "@domain/ai/core/ai-config-resolver.js";

const logger = createLogger("AISelfHealing");

export class AIHealingService {

    /**
     * Attempts to find a new selector for a broken element using a more advanced LLM analysis,
     * including proximity awareness and semantic role analysis.
     */
    async healSelectorV2(brokenSelector: string, pageHtml: string, errorContext: string, strategy: 'minimal' | 'proximity' | 'semantic' = 'proximity'): Promise<string | null> {
        try {
            logger.info("Attempting Lazarus Selector Healing (V2)", { brokenSelector, strategy });

            const aiConfig = await aiConfigResolver.resolveSystemConfig('faultAnalysis');
            if (!aiConfig) return null;

            const client = AIClientFactory.getClient({
                provider: aiConfig.provider,
                model: aiConfig.model
            } as any);

            const prunedHtml = await import("@server/utils/html-pruning.js").then(m => m.pruneHtmlForAi(pageHtml));
            const truncatedHtml = prunedHtml.substring(0, 25000);

            const prompt = `
            Task: Repair a broken CSS/XPath selector for an automated mission.
            
            Context:
            - Target Selector (Failed): "${brokenSelector}"
            - Execution Error: "${errorContext}"
            - Strategy: "${strategy}" (Focus on surrounding structure if primary fails)
            
            Current DOM Snapshot:
            \`\`\`html
            ${truncatedHtml}
            \`\`\`

            Instructions:
            1. Analyze the failed selector and understand its intended function.
            2. Identify the element in the new DOM that fulfills the same semantic purpose.
               - Look for: proximity to stable anchors, identical ARIA roles, similar label text, or matching data attributes.
            3. CRITICAL: Generate a ROBUST selector (prefers IDs, unique data-attributes, or stable role-based paths).
            4. Return ONLY the selector string. If multiple valid candidates exist, pick the most stable one. 
            5. Return "NULL" if no match is found.
            `;

            const result = await client.execute({
                credentialId: aiConfig.credentialId,
                model: aiConfig.model || "gemini-2.0-flash",
                userPrompt: prompt,
                temperature: 0,
                requestType: "text",
                useCache: true, // Performance enhancement: Enabled caching
                saveOutputToFile: false
            }, undefined, aiConfig.apiKey);

            if (result.success && result.output) {
                const newSelector = result.output.trim().replace(/^`+|`+$/g, '');
                if (newSelector === "NULL" || newSelector.length < 2) return null;

                logger.info("Lazarus successfully healed selector", { old: brokenSelector, new: newSelector });
                return newSelector;
            }
        } catch (error) {
            logger.error("Lazarus healing failed", { error });
        }
        return null;
    }

    /**
     * Legacy wrapper for healSelector
     */
    async healSelector(brokenSelector: string, pageHtml: string, errorContext: string): Promise<string | null> {
        return this.healSelectorV2(brokenSelector, pageHtml, errorContext, 'minimal');
    }

    /**
     * Attempts to fix malformed JSON using an LLM.
     * @param malformedJson The JSON string that failed to parse
     * @param context Optional description of what the JSON should contain
     */
    async healJson(malformedJson: string, context?: string): Promise<string | null> {
        return this.healJsonV2(malformedJson, context);
    }

    /**
     * Internal implementation for JSON healing
     */
    private async healJsonV2(malformedJson: string, context?: string): Promise<string | null> {
        try {
            logger.info("Attempting to heal JSON content");

            const aiConfig = await aiConfigResolver.resolveSystemConfig('faultAnalysis');
            if (!aiConfig) return null;

            const client = AIClientFactory.getClient({
                provider: aiConfig.provider,
                model: aiConfig.model
            } as any);

            const prompt = `
            Task: Fix this malformed JSON.
            
            Context: ${context || "Unknown data structure"}
            
            Malformed JSON:
            ${malformedJson}

            Instructions:
            1. Correct the syntax errors (missing quotes, trailing commas, unclosed brackets, etc.).
            2. Return ONLY the valid JSON object. No markdown, no explanations.
            3. If the JSON is beyond repair, return "NULL".
            `;

            const result = await client.execute({
                credentialId: aiConfig.credentialId,
                model: aiConfig.model || "gemini-2.0-flash",
                userPrompt: prompt,
                temperature: 0,
                requestType: "text",
                useCache: true,
                saveOutputToFile: false
            }, undefined, aiConfig.apiKey);

            if (result.success && result.output) {
                let fixed = result.output.trim();
                // Strip markdown formatting if AI added it anyway
                if (fixed.startsWith("```json")) fixed = fixed.replace(/^```json\s*/, '').replace(/```\s*$/, '');
                else if (fixed.startsWith("```")) fixed = fixed.replace(/^```\s*/, '').replace(/```\s*$/, '');
                
                if (fixed === "NULL") return null;
                
                try {
                    JSON.parse(fixed); // Validate
                    return fixed;
                } catch (e) {
                    logger.warn("AI-healed JSON still failed to parse", { error: (e as Error).message });
                    return null;
                }
            }
        } catch (error) {
            logger.error("Failed to heal JSON", { error });
        }
        return null;
    }

    /**
     * Queueing methods for distributed execution
     */
    async healSelectorAsync(missionId: number, brokenSelector: string, pageHtml: string, errorContext: string, strategy: 'minimal' | 'proximity' | 'semantic' = 'proximity'): Promise<string | null> {
        const { queueService } = await import("@domain/core/infrastructure/queue/queue-service.js");
        const job = await queueService.addJobWithTrace(queueService.healingQueue, "heal-selector", {
            type: 'selector',
            missionId,
            context: { brokenSelector, pageHtml, errorContext, strategy }
        });
        
        try {
            const result = await queueService.waitForJob(queueService.healingEvents, job);
            return result.success ? result.output : null;
        } catch (err) {
            logger.error("Async selector healing timed out or failed", { error: (err as Error).message });
            return null;
        }
    }

    async healJsonAsync(missionId: number, malformedJson: string, description?: string): Promise<string | null> {
        const { queueService } = await import("@domain/core/infrastructure/queue/queue-service.js");
        const job = await queueService.addJobWithTrace(queueService.healingQueue, "heal-json", {
            type: 'json',
            missionId,
            context: { malformedJson, description }
        });

        try {
            const result = await queueService.waitForJob(queueService.healingEvents, job);
            return result.success ? result.output : null;
        } catch (err) {
            logger.error("Async JSON healing timed out or failed", { error: (err as Error).message });
            return null;
        }
    }
}

export const aiHealingService = new AIHealingService();


