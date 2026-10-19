import type { AIApiCallConfig } from "@shared/schema/index.js";
import { AIClient, AIResponse, GeminiFileAttachment, fetchWithRetry } from "../ai-client.service.js";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";

export class AzureClient implements AIClient {
    constructor(private metadata?: { apiEndpoint?: string; apiVersion?: string }) { }

    async execute(
        config: AIApiCallConfig,
        input: string | undefined,
        apiKey: string,
        _fileAttachments?: GeminiFileAttachment[],
        _traceContext?: TraceContext
    ): Promise<AIResponse> {
        const startTime = Date.now();

        try {
            const userPrompt = config.userPrompt;
            const systemPrompt = config.systemPrompt;

            const messages: Array<{ role: string; content: any }> = [];
            if (config.messages && config.messages.length > 0) {
                if (systemPrompt && !config.messages.some(m => m.role === "system")) {
                    messages.push({ role: "system", content: systemPrompt });
                }
                messages.push(...config.messages);
            } else {
                if (systemPrompt) {
                    messages.push({ role: "system", content: systemPrompt });
                }
                messages.push({ role: "user", content: userPrompt });
            }

            const requestBody: any = {
                messages,
                temperature: config.temperature ?? 0.7,
            };

            if (config.requestType === "json") {
                requestBody.response_format = { type: "json_object" };
            }

            if (config.maxTokens) {
                requestBody.max_tokens = config.maxTokens;
            }

            const apiEndpoint = config.baseUrl || this.metadata?.apiEndpoint || "";
            const apiVersion = this.metadata?.apiVersion || "2024-02-01";
            const endpoint = `${apiEndpoint.replace(/\/$/, "")}/openai/deployments/${config.model}/chat/completions?api-version=${apiVersion}`;

            const headers: Record<string, string> = {
                "Content-Type": "application/json",
                "api-key": apiKey,
            };

            const response = await fetchWithRetry(endpoint, {
                method: "POST",
                headers,
                body: JSON.stringify(requestBody),
            });

            const latencyMs = Date.now() - startTime;

            if (!response.ok) {
                const errorText = await response.text();
                return {
                    success: false,
                    error: `Azure OpenAI API error (${response.status}): ${errorText}`,
                    metadata: {
                        model: config.model,
                        provider: "azure",
                        latencyMs,
                    },
                };
            }

            const data = await response.json();

            return {
                success: true,
                output: data.choices?.[0]?.message?.content || "",
                metadata: {
                    model: config.model,
                    provider: "azure",
                    tokensUsed: data.usage?.total_tokens,
                    promptTokens: data.usage?.prompt_tokens,
                    completionTokens: data.usage?.completion_tokens,
                    latencyMs,
                },
            };
        } catch (error) {
            const latencyMs = Date.now() - startTime;
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata: {
                    model: config.model,
                    provider: "azure",
                    latencyMs,
                },
            };
        }
    }

    async *executeStream(
        config: AIApiCallConfig,
        input: string | undefined,
        apiKey: string,
        _fileAttachments?: GeminiFileAttachment[],
        _traceContext?: TraceContext
    ): AsyncIterable<string> {
        const userPrompt = config.userPrompt;
        const systemPrompt = config.systemPrompt;

        const messages: Array<{ role: string; content: any }> = [];
        if (config.messages && config.messages.length > 0) {
            if (systemPrompt && !config.messages.some(m => m.role === "system")) {
                messages.push({ role: "system", content: systemPrompt });
            }
            messages.push(...config.messages);
        } else {
            if (systemPrompt) {
                messages.push({ role: "system", content: systemPrompt });
            }
            messages.push({ role: "user", content: userPrompt });
        }

        const requestBody: any = {
            messages,
            temperature: config.temperature ?? 0.7,
            stream: true,
        };

        if (config.requestType === "json") {
            requestBody.response_format = { type: "json_object" };
        }

        if (config.maxTokens) {
            requestBody.max_tokens = config.maxTokens;
        }

        const apiEndpoint = config.baseUrl || this.metadata?.apiEndpoint || "";
        const apiVersion = this.metadata?.apiVersion || "2024-02-01";
        const endpoint = `${apiEndpoint.replace(/\/$/, "")}/openai/deployments/${config.model}/chat/completions?api-version=${apiVersion}`;

        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "api-key": apiKey,
        };

        const response = await fetchWithRetry(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Azure OpenAI Stream Error (${response.status}): ${errorText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (line.trim() === "" || line.trim() === "data: [DONE]") continue;
                    if (line.startsWith("data: ")) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.choices?.[0]?.delta?.content) {
                                yield data.choices[0].delta.content;
                            }
                        } catch (e) {
                            console.error("[Azure Stream] Failed to parse line:", line);
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }
}
