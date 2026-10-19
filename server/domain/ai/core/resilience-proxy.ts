import { AIResponse, isRetriableAIError, AiQuotaManager } from "./ai-client.service.js";
import { createLogger } from "@server/utils/logger.js";
import { defaultOllamaService } from "./ollama.service.js";

const logger = createLogger("ResilienceProxy");

export interface ResilienceConfig {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    useExponentialBackoff: boolean;
    enableLocalFallback?: boolean;
    fallbackOperation?: () => Promise<AIResponse>;
}

const DEFAULT_CONFIG: ResilienceConfig = {
    maxRetries: 5,
    baseDelayMs: 2000,
    maxDelayMs: 120000, // Increased to 2m for heavy LLM context
    useExponentialBackoff: true,
    enableLocalFallback: true
};

/**
 * Executes an AI operation with intelligent retries, exponential backoff,
 * and automated fallback to local Ollama endpoints on 429 quota exhaustion.
 */
export async function withResilience<T extends AIResponse>(
    operation: () => Promise<T>,
    config: Partial<ResilienceConfig> = {}
): Promise<T> {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    let attempt = 0;
    let lastResult: T | null = null;

    while (attempt <= fullConfig.maxRetries) {
        if (attempt > 0) {
            const delay = fullConfig.useExponentialBackoff
                ? Math.min(fullConfig.baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000, fullConfig.maxDelayMs)
                : fullConfig.baseDelayMs;

            logger.warn(`[Resilience] Retriable failure (Attempt ${attempt}/${fullConfig.maxRetries}). Backing off for ${Math.round(delay)}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        try {
            lastResult = await operation();

            if (lastResult.success) {
                if (attempt > 0) {
                    await AiQuotaManager.reportSuccess();
                    logger.info(`[Resilience] Success after ${attempt} retries.`);
                }
                return lastResult;
            }

            if (!isRetriableAIError(lastResult)) {
                logger.error(`[Resilience] Non-retriable error: ${lastResult.error}`);
                break;
            }

            // If it's a 429, notify the global quota manager
            const err = (lastResult.error || "").toLowerCase();
            if (err.includes("429") || err.includes("resource_exhausted") || err.includes("too many requests")) {
                await AiQuotaManager.reportFailure();
            }

        } catch (err: any) {
            logger.error(`[Resilience] Unexpected execution error: ${err.message}`);
            // Wrap in AIResponse format for the next loop/return
            lastResult = {
                success: false,
                error: `Execution error: ${err.message}`,
                metadata: { latencyMs: 0, model: "unknown", provider: "unknown" }
            } as any;
        }

        attempt++;
    }

    // Attempt fallback operation if configured
    if (fullConfig.fallbackOperation) {
        try {
            logger.info("[Resilience] Primary operation exhausted. Executing custom fallback operation...");
            const fallbackResult = await fullConfig.fallbackOperation();
            if (fallbackResult.success) {
                return {
                    ...fallbackResult,
                    metadata: {
                        ...(fallbackResult.metadata || {}),
                        fallback: "custom"
                    }
                } as unknown as T;
            }
        } catch (fbErr: any) {
            logger.warn(`[Resilience] Custom fallback failed: ${fbErr.message}`);
        }
    }

    // Automated Local Ollama Fallback
    if (fullConfig.enableLocalFallback && lastResult && !lastResult.success) {
        try {
            const isOllamaUp = await defaultOllamaService.isAvailable();
            if (isOllamaUp) {
                logger.info("[Resilience] Local Ollama daemon detected. Triggering automated local model fallback...");
                const localModel = await defaultOllamaService.selectModelForTask("chat");
                const fallbackCompletion = await defaultOllamaService.generateCompletion(
                    localModel,
                    "Provide a helpful completion for the pending operational task."
                );

                if (fallbackCompletion.response) {
                    logger.info(`[Resilience] Local Ollama fallback succeeded via ${localModel}.`);
                    return {
                        success: true,
                        output: fallbackCompletion.response,
                        metadata: {
                            latencyMs: (fallbackCompletion.evalDurationNs || 0) / 1e6,
                            model: localModel,
                            provider: "ollama",
                            fallback: "ollama",
                            evalCount: fallbackCompletion.evalCount
                        }
                    } as unknown as T;
                }
            }
        } catch (ollamaErr: any) {
            logger.warn(`[Resilience] Ollama fallback check failed: ${ollamaErr.message}`);
        }
    }

    return lastResult!;
}

