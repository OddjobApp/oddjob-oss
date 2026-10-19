import { db } from "@server/database_service.js";
import { systemSettings, credentials, type SystemAiDefaults } from "@shared/schema/index.js";
import { eq, and, isNull } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { aiConfigResolver } from "./ai-config-resolver.js";
import type { FallbackConfig } from "@domain/ai/core/ai-client.service.js";
import { LocalSLMService, type SLMTaskType } from "./local-slm.service.js";


const logger = createLogger("SystemAiService");

/**
 * Task types that map to low-stakes, deterministic operations safe for local SLM routing.
 * Cloud LLMs are reserved for mission-critical, creative, or multi-step reasoning tasks.
 */
const LOCAL_SLM_TASK_TYPES = new Set<string>([
    'classify',
    'blueprint-classify',
    'summarize',
    'syntax-audit',
    'extract',
    'tag',
]);

const SLM_TASK_TYPE_MAP: Record<string, SLMTaskType> = {
    'classify': 'classify',
    'blueprint-classify': 'classify',
    'summarize': 'summarize',
    'syntax-audit': 'extract',
    'extract': 'extract',
    'tag': 'classify',
};

export type SystemServiceKey = 'concierge' | 'copilot' | 'faultAnalysis' | 'architect' | 'governor' | 'threat_detector' | 'business_analyst' | 'forecaster' | 'compliance_officer' | 'auditor' | 'specialist' | 'codegen';

export interface SystemAiConfig {
    provider: string;
    model: string;
    credentialId?: number;
    credential?: any; // The full credential object if needed
    baseUrl?: string;
    apiKey?: string;
    timeoutMs?: number;
}

export interface SystemAiConfigWithFallback {
    primary: SystemAiConfig;
    fallbacks: FallbackConfig[];
}

export class SystemAiService {
    /**
     * Get the configured AI provider and model for a system service.
     * Resolves the actual credential to use.
     */
    async getAiConfig(serviceKey: SystemServiceKey, orgId?: number): Promise<SystemAiConfig | null> {
        // Never cache decrypted credentials. Resolve current org ownership and key
        // on every call so rotation and disconnect are effective immediately.
        return aiConfigResolver.resolveOrgConfig(serviceKey, orgId ?? null);
    }

    /**
     * Get AI config with fallback chain for Multi-Model Fallback (AI_AGENT_ENHANCEMENTS_SPEC).
     */
    async getAiConfigWithFallback(serviceKey: SystemServiceKey, orgId?: number): Promise<SystemAiConfigWithFallback | null> {
        const primary = await this.getAiConfig(serviceKey, orgId);
        if (!primary) return null;
        const { resolveAiOrganization } = await import("./ai-org-context.js");
        const { orgModelService } = await import("./org-model.service.js");
        const aiOrg = await resolveAiOrganization(orgId ?? null);
        if (aiOrg !== null && await orgModelService.resolve(aiOrg)) return { primary, fallbacks: [] };
        const resolved = await aiConfigResolver.resolveSystemConfigWithFallback(serviceKey);
        return { primary, fallbacks: resolved?.fallbacks ?? [] };
    }

    /**
     * Cost-optimized task router.
     *
     * Routes low-stakes, deterministic tasks (classification, summarization, syntax checks)
     * to local Small Language Models (Ollama) first, dramatically cutting API costs.
     * Falls back to the configured cloud provider if local execution fails or the model
     * is not available.
     *
     * Usage:
     *   const result = await systemAiService.getOptimalModelForTask('classify', prompt);
     *   const result = await systemAiService.getOptimalModelForTask('summarize', prompt);
     *   const result = await systemAiService.getOptimalModelForTask('codegen', prompt); // → cloud
     *
     * @param taskType  The type of task to execute. Low-stakes types use local SLMs.
     * @param prompt    The prompt to execute.
     * @param options   Optional overrides (model, temperature, serviceKey).
     */
    async getOptimalModelForTask(
        taskType: string,
        prompt: string,
        options: { model?: string; temperature?: number; serviceKey?: SystemServiceKey } = {}
    ): Promise<string | null> {
        // Route low-stakes tasks to local SLM (Ollama) first
        if (process.env.NODE_ENV !== "production" && LOCAL_SLM_TASK_TYPES.has(taskType)) {
            const slmTaskType = SLM_TASK_TYPE_MAP[taskType] || 'classify';
            logger.debug(`[SystemAI/CostRouter] Routing '${taskType}' to Local SLM (task=${slmTaskType})`);

            try {
                const localResult = await LocalSLMService.execute(
                    slmTaskType,
                    prompt,
                    false // don't auto-fallback — we handle fallback below
                );
                if (localResult) {
                    logger.info(`[SystemAI/CostRouter] Local SLM resolved '${taskType}' task. Cost: $0.`);
                    return localResult;
                }
            } catch (localErr: any) {
                logger.warn(`[SystemAI/CostRouter] Local SLM unavailable for '${taskType}': ${localErr.message}. Falling back to cloud.`);
            }
        }

        // Cloud fallback (or primary path for mission-critical tasks)
        logger.debug(`[SystemAI/CostRouter] Routing '${taskType}' to cloud provider.`);
        return this.generateText(prompt, {
            model: options.model,
            temperature: options.temperature ?? 0.1,
            serviceKey: options.serviceKey,
        });
    }


    /**
     * Generate plain text using the system-wide preferred model.
     * Mirrors the generateJson signature for callers that just need a string back.
     */
    async generateText(prompt: string, options: { model?: string; temperature?: number; serviceKey?: SystemServiceKey; onHeartbeat?: (metrics: any) => void; useCache?: boolean } = {}): Promise<string | null> {
        const serviceKey: SystemServiceKey = options.serviceKey || 'copilot';
        const config = await this.getAiConfig(serviceKey);
        if (!config || !config.apiKey) {
            logger.error(`[SystemAI] Failed to resolve API key for service: ${serviceKey}`);
            return null;
        }

        const { AIClientFactory } = await import("./ai-client.service.js");
        const client = AIClientFactory.getClient({ provider: config.provider, baseUrl: config.baseUrl } as any);

        const response = await client.execute({
            userPrompt: prompt,
            model: options.model || config.model,
            temperature: options.temperature ?? 0.1,
            useCache: options.useCache ?? false,
            saveOutputToFile: false,
        }, prompt, config.apiKey || "", undefined, undefined, options.onHeartbeat);

        if (!response.success) {
            logger.error(`[SystemAI] AI call failed for ${serviceKey}: ${response.error}`);
            return null;
        }
        return response.output || null;
    }

    /**
     * Streaming variant of generateText. Forwards each token delta to `onToken`
     * as the model produces it (real first-token latency), accumulates the full
     * text, and returns it. Falls back to a single non-streaming call if the
     * resolved client can't stream or the stream errors before any output — so
     * callers always get a complete answer regardless of provider support.
     */
    async streamText(
        prompt: string,
        options: { model?: string; temperature?: number; serviceKey?: SystemServiceKey; useCache?: boolean } = {},
        onToken: (delta: string) => void,
    ): Promise<string | null> {
        const serviceKey: SystemServiceKey = options.serviceKey || 'copilot';
        const config = await this.getAiConfig(serviceKey);
        if (!config || !config.apiKey) {
            logger.error(`[SystemAI] Failed to resolve API key for service: ${serviceKey}`);
            return null;
        }

        const { AIClientFactory } = await import("./ai-client.service.js");
        const client = AIClientFactory.getClient({ provider: config.provider, baseUrl: config.baseUrl } as any);

        if (typeof client.executeStream !== "function") {
            // No streaming support — emit the whole answer as one delta so the
            // caller's rendering path still works.
            const full = await this.generateText(prompt, options);
            if (full) onToken(full);
            return full;
        }

        let acc = "";
        try {
            for await (const chunk of client.executeStream({
                userPrompt: prompt,
                model: options.model || config.model,
                temperature: options.temperature ?? 0.1,
                useCache: options.useCache ?? false,
                saveOutputToFile: false,
            } as any, prompt, config.apiKey || "")) {
                if (chunk) { acc += chunk; try { onToken(chunk); } catch { /* sink is best-effort */ } }
            }
        } catch (e: any) {
            logger.error(`[SystemAI] streamText failed for ${serviceKey}: ${e?.message || e}`);
            // Nothing streamed yet → fall back to a full non-streaming answer.
            if (!acc) {
                const full = await this.generateText(prompt, options);
                if (full) onToken(full);
                return full;
            }
        }
        return acc || null;
    }

    /**
     * Helper to generate JSON using the system-wide preferred model.
     * Often used by internal agents for structuring raw data.
     */
    async generateJson(prompt: string, serviceKey: SystemServiceKey = 'concierge', configOverride: any = {}, onHeartbeat?: (metrics: any) => void): Promise<any> {
        logger.info(`[SystemAI] generateJson starting for service: ${serviceKey} - Prompt length: ${prompt.length}`);
        const config = await aiConfigResolver.resolveSystemConfig(serviceKey);
        if (!config) return null;

        const { AIClientFactory } = await import("./ai-client.service.js");
        const client = AIClientFactory.getClient({
            provider: config.provider,
            baseUrl: config.baseUrl
        } as any);

        const response = await client.execute({
            systemPrompt: "You are the Tactical Mission Architect. Return ONLY raw JSON. No markdown, no preambles.",
            userPrompt: prompt,
            model: config.model,
            requestType: 'json',
            ...configOverride
        }, prompt, config.apiKey || "", undefined, undefined, onHeartbeat);

        if (!response.success) {
            logger.error(`[SystemAI] AI call failed for ${serviceKey}: ${response.error}`);
            return null;
        }

        const rawOutput = response.output || "{}";
        logger.debug(`[SystemAI] Raw AI output for ${serviceKey} (first 200 chars): ${rawOutput.substring(0, 200)}`);

        try {
            const cleaned = this.extractJson(rawOutput);
            const parsed = JSON.parse(cleaned);
            logger.info(`[SystemAI] Successfully parsed JSON for ${serviceKey}`);
            return parsed;
        } catch (err: any) {
            logger.error(`[SystemAI] JSON Parse failed for ${serviceKey}: ${err.message}. Raw: ${rawOutput.substring(0, 500)}`);
            return null;
        }
    }

    /**
     * Robustly extracts JSON from a potentially messy string (markdown blocks, thoughts, etc.)
     */
    private extractJson(text: string): string {
        let cleaned = text.trim();

        // 1. Strip Thought tags (common in reasoning models like DeepSeek)
        cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/g, '').trim();

        // 2. Extract from markdown code blocks if present
        const jsonBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (jsonBlockMatch) {
            cleaned = jsonBlockMatch[1].trim();
        }

        // 3. Find the first '{' or '[' and last '}' or ']'
        const firstCurly = cleaned.indexOf('{');
        const firstSquare = cleaned.indexOf('[');
        const lastCurly = cleaned.lastIndexOf('}');
        const lastSquare = cleaned.lastIndexOf(']');

        // Determine the start and end of the actual JSON structure
        let start = -1;
        let end = -1;

        if (firstCurly !== -1 && (firstSquare === -1 || firstCurly < firstSquare)) {
            start = firstCurly;
            end = lastCurly;
        } else if (firstSquare !== -1) {
            start = firstSquare;
            end = lastSquare;
        }

        if (start !== -1 && end !== -1 && end > start) {
            cleaned = cleaned.substring(start, end + 1);
        }

        return cleaned;
    }
}

export const systemAiService = new SystemAiService();
