import type { AIApiCallConfig } from "@shared/schema/index.js";
import { AIClient, AIResponse, GeminiFileAttachment, fetchWithRetry } from "../ai-client.service.js";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";

export class DalleClient implements AIClient {
    async execute(
        config: AIApiCallConfig,
        _input: string | undefined,
        apiKey: string,
        _fileAttachments?: GeminiFileAttachment[],
        _traceContext?: TraceContext
    ): Promise<AIResponse> {
        const startTime = Date.now();
        try {
            const response = await fetchWithRetry("https://api.openai.com/v1/images/generations", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model: config.model || "dall-e-3",
                    prompt: config.userPrompt,
                    n: 1,
                    size: "1024x1024",
                }),
            });

            const latencyMs = Date.now() - startTime;

            if (!response.ok) {
                const errorText = await response.text();
                return {
                    success: false,
                    error: `DALL-E API error (${response.status}): ${errorText}`,
                    metadata: { model: config.model, provider: "openai-dalle", latencyMs },
                };
            }

            const data = await response.json();
            const imageUrl = data.data?.[0]?.url || "";

            return {
                success: true,
                output: imageUrl,
                metadata: { model: config.model, provider: "openai-dalle", latencyMs },
            };
        } catch (error) {
            const latencyMs = Date.now() - startTime;
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata: { model: config.model, provider: "openai-dalle", latencyMs },
            };
        }
    }
}


