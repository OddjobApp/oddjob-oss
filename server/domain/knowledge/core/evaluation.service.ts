import { db } from "@server/database_service.js";
import { scoringRules, scoringEvents, type ScoringRule, agentChatMessages } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

export const evaluationService = {
    /**
     * Evaluate an agent's response against active scoring rules.
     * Records any rule matches as scoring events.
     */
    async evaluateResponse(messageId: number, content: string, context: { jobId?: number, userId?: string } = {}) {
        try {
            // 1. Fetch active evaluation rules
            const rules = await db.select()
                .from(scoringRules)
                .where(and(
                    eq(scoringRules.enabled, true),
                    eq(scoringRules.ruleType, 'agent_evaluation')
                ));

            if (rules.length === 0) return;

            console.log(`[EvaluationService] Evaluating message ${messageId} against ${rules.length} rules.`);

            // 2. Evaluate each rule
            for (const rule of rules) {
                const isMatch = await this.checkRule(rule, content);

                if (isMatch) {
                    await this.recordMatch(messageId, rule, context);
                }
            }

        } catch (error) {
            console.error("[EvaluationService] Error evaluating response:", error);
        }
    },

    /**
     * Check if a specific rule matches the content
     */
    async checkRule(rule: ScoringRule, content: string): Promise<boolean> {
        const config = rule.evaluationConfig;
        if (!config) return false;

        try {
            switch (config.method) {
                case 'regex':
                    const regex = new RegExp(config.criteria, 'i');
                    return regex.test(content);

                case 'keyword':
                    const keywords = config.criteria.split(',').map(k => k.trim().toLowerCase());
                    const lowerContent = content.toLowerCase();
                    // Match if ANY keyword is present
                    return keywords.some(k => lowerContent.includes(k));

                case 'llm_judge':
                    return await this.evaluateWithLLM(content, config.criteria, config.model);

                default:
                    console.warn(`[EvaluationService] Unknown evaluation method: ${config.method}`);
                    return false;
            }
        } catch (e) {
            console.error(`[EvaluationService] Rule check failed for "${rule.name}":`, e);
            return false;
        }
    },

    /**
     * Use an LLM to judge the content based on criteria.
     * Criteria should be a Yes/No question or assertion.
     */
    async evaluateWithLLM(content: string, criteria: string, modelOverride?: string): Promise<boolean> {
        try {
            // Get AI Config (defaulting to a fast/cheap model if possible)
            const config = await systemAiService.getAiConfig('copilot') || { provider: 'google', model: 'gemini-1.5-flash' };
            const modelToUse = modelOverride || config.model;

            const apiKey = this.resolveApiKey(config);
            const aiClient = AIClientFactory.getClient({ provider: config.provider, baseUrl: config.baseUrl } as any);

            const prompt = `
            You are an impartial judge evaluating an AI Agent's response.
            
            AGENT RESPONSE:
            "${content}"
            
            EVALUATION CRITERIA:
            ${criteria}
            
            INSTRUCTIONS:
            - Determine if the response MEETS the criteria.
            - Respond with ONLY "YES" or "NO".
            `;

            const result = await aiClient.execute({
                model: modelToUse,
                userPrompt: prompt,
                temperature: 0, // Deterministic
                systemPrompt: "You are a strict evaluation engine. Output only YES or NO."
            } as any, undefined, apiKey);

            if (!result.success || !result.output) return false;

            const verdict = result.output.trim().toUpperCase();
            return verdict.includes("YES");

        } catch (error) {
            console.error("[EvaluationService] LLM Judge error:", error);
            return false;
        }
    },

    /**
     * Record a successful rule match
     */
    async recordMatch(messageId: number, rule: ScoringRule, context: any) {
        console.log(`[EvaluationService] Rule Matched: "${rule.name}" (Vector: ${rule.vector})`);

        await db.insert(scoringEvents).values({
            sessionId: context.jobId ? `job-${context.jobId}` : 'unknown',
            eventType: 'rule_match',
            ruleId: rule.id,
            actionType: rule.triggeredAction?.type || 'log_event',
            actionConfig: rule.triggeredAction?.config || {},
            vectorState: { [rule.vector]: rule.weight },
            confidence: 1.0,
            location: `message-${messageId}`,
        });

        // --- AUTO-RATING LOGIC (Closing the Loop) ---
        // If the rule indicates a positive Outcome (O), rate the message as Good (+1)
        // If the rule indicates a negative Symptom (S), rate the message as Bad (-1)

        let newRating: number | null = null;
        if (rule.vector === 'O') newRating = 1;
        if (rule.vector === 'S') newRating = -1;

        if (newRating !== null) {
            console.log(`[EvaluationService] Auto-Rating message ${messageId} as ${newRating} (Vector: ${rule.vector})`);
            await db.update(agentChatMessages)
                .set({ rating: newRating })
                .where(eq(agentChatMessages.id, messageId));
        }
    },

    resolveApiKey(config: any): string {
        let apiKey = config.apiKey || developmentProviderKey();
        if (config.provider === 'openai') apiKey = config.apiKey || developmentProviderKey("openai");
        if (config.provider === 'anthropic') apiKey = config.apiKey || developmentProviderKey("anthropic");
        return apiKey;
    }
};


