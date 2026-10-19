import type { AIApiCallConfig } from "@shared/schema/index.js";
import { AIClient, AIResponse, GeminiFileAttachment, fetchWithRetry } from "../ai-client.service.js";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";

export class MidjourneyClient implements AIClient {
    constructor(private metadata: { baseUrl: string }) { }

    async execute(
        config: AIApiCallConfig,
        input: string | undefined,
        apiKey: string,
        fileAttachments?: GeminiFileAttachment[],
        _traceContext?: TraceContext
    ): Promise<AIResponse> {
        const startTime = Date.now();
        try {
            console.log(`[Midjourney Client] Sending prompt to ${this.metadata.baseUrl}`);

            const response = await fetchWithRetry(this.metadata.baseUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    prompt: config.userPrompt,
                    mode: (this.metadata as any).mode || 'fast'
                }),
            });

            const latencyMs = Date.now() - startTime;

            if (!response.ok) {
                const errorText = await response.text();
                return {
                    success: false,
                    error: `Midjourney API error (${response.status}): ${errorText}`,
                    metadata: {
                        model: "midjourney",
                        provider: "midjourney",
                        latencyMs,
                    },
                };
            }

            const data = await response.json();

            // Attempt to find image URL or just return whole JSON
            const output = data.url || data.imageUrl || data.image_url || JSON.stringify(data);

            return {
                success: true,
                output,
                metadata: {
                    model: "midjourney",
                    provider: "midjourney",
                    latencyMs,
                },
            };
        } catch (error) {
            const latencyMs = Date.now() - startTime;
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata: {
                    model: "midjourney",
                    provider: "midjourney",
                    latencyMs,
                },
            };
        }
    }
}


