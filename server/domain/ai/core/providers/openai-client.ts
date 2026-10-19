import type { AIApiCallConfig } from "@shared/schema/index.js";
import { AIClient, AIResponse, GeminiFileAttachment, fetchWithRetry } from "../ai-client.service.js";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("OpenAIClient");
import {
    applyMultiTokenPredictionRequestBody,
    buildMultiTokenPredictionMetadata,
    constrainMultiTokenPredictionPassthrough,
    resolveMultiTokenPrediction,
    type MultiTokenPredictionConfig,
} from "../multi-token-prediction.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

export class OpenAIClient implements AIClient {
    constructor(private metadata?: { baseUrl?: string; multiTokenPrediction?: MultiTokenPredictionConfig }) { }

    async execute(
        config: AIApiCallConfig,
        input: string | undefined,
        apiKey: string,
        _fileAttachments?: GeminiFileAttachment[],
        _traceContext?: TraceContext
    ): Promise<AIResponse> {
        const startTime = Date.now();

        // Auto-detect Google Gemini API keys passed to OpenAI provider and delegate seamlessly.
        // Never delegate when a custom baseUrl is set: an explicit endpoint (Muse, DashScope,
        // LM Studio, ...) means the caller deliberately targeted a non-OpenAI host, and
        // rerouting to Gemini would silently answer on the wrong vendor with the wrong key.
        const customEndpoint = Boolean(config.baseUrl || this.metadata?.baseUrl);
        const isGoogleKey = !customEndpoint &&
            (apiKey?.startsWith("AIzaSy") || (!apiKey && !developmentProviderKey("openai") && !!developmentProviderKey()));
        if (isGoogleKey) {
            logger.warn("[OpenAIClient] Google Gemini API key detected on OpenAI provider call. Auto-delegating to GoogleClient.");
            const { GoogleClient } = await import("./google-client.js");
            const googleClient = new GoogleClient();
            const googleApiKey = apiKey?.startsWith("AIzaSy") ? apiKey : developmentProviderKey();
            const googleConfig = {
                ...config,
                provider: "google",
                model: config.model?.toLowerCase().includes("gemini") ? config.model : "gemini-1.5-flash"
            };
            return googleClient.execute(googleConfig, input, googleApiKey, _fileAttachments, _traceContext);
        }

        try {
            // Send prompts exactly as configured - no {{input}} substitution
            const userPrompt = config.userPrompt;
            const systemPrompt = config.systemPrompt;

            // Debug: Log prompt details
            console.log('[OpenAI Client] User prompt length:', userPrompt.length);
            console.log('[OpenAI Client] User prompt preview (first 500 chars):', userPrompt.substring(0, 500));
            if (userPrompt.includes('---')) {
                console.log('[OpenAI Client] RAG context detected in prompt (contains separator)');
                const ragIndex = userPrompt.indexOf('---');
                console.log('[OpenAI Client] RAG context starts at position:', ragIndex);
                console.log('[OpenAI Client] RAG context preview:', userPrompt.substring(ragIndex, ragIndex + 500));
            }

            const messages: Array<{ role: string; content: any }> = [];
            if (config.messages && config.messages.length > 0) {
                if (systemPrompt && !config.messages.some(m => m.role === "system")) {
                    messages.push({ role: "system", content: systemPrompt });
                }
                messages.push(...config.messages.map(m => ({
                    role: m.role === "model" ? "assistant" : m.role,
                    content: m.content
                })));
            } else {
                if (systemPrompt) {
                    messages.push({ role: "system", content: systemPrompt });
                }

                let userContent: any = userPrompt;

                // Handle Attachments (Multi-Modal)
                if (config.attachments && config.attachments.length > 0) {
                    userContent = [{ type: "text", text: userPrompt }];
                    config.attachments.forEach(att => {
                        if (att.type === 'image_url') {
                            userContent.push({
                                type: "image_url",
                                image_url: {
                                    url: att.url,
                                    detail: att.detail || "auto"
                                }
                            });
                        }
                    });
                }

                messages.push({ role: "user", content: userContent });
            }

            const requestBody: any = {
                model: config.model,
                messages,
                temperature: config.temperature ?? 0.7,
            };

            if (config.adapterPath) {
                requestBody.model = config.adapterPath;
                requestBody.lora_path = config.adapterPath;
                logger.info(`[OpenAIClient] Attaching LoRA adapter: ${config.adapterPath}`);
            }

            // Enable JSON mode if requestType is "json" (for OpenAI)
            if (config.requestType === "json") {
                requestBody.response_format = { type: "json_object" };
            }

            // Native function calling. The same declaration shape the Google and
            // Ollama clients accept ({name, description, inputSchema|parameters}),
            // wrapped in the OpenAI function envelope.
            if (config.tools && config.tools.length > 0) {
                requestBody.tools = config.tools.map((t: any) => ({
                    type: "function",
                    function: {
                        name: t.name,
                        description: t.description,
                        parameters: t.inputSchema || t.parameters || { type: "object", properties: {}, required: [] },
                    },
                }));
            }

            if (config.maxTokens) {
                requestBody.max_tokens = config.maxTokens;
            }

            const multiTokenPrediction = constrainMultiTokenPredictionPassthrough(
                resolveMultiTokenPrediction(config, this.metadata),
                Boolean(config.baseUrl || this.metadata?.baseUrl)
            );
            applyMultiTokenPredictionRequestBody(requestBody, multiTokenPrediction);
            const inferenceAcceleration = buildMultiTokenPredictionMetadata(multiTokenPrediction);

            const baseUrl = config.baseUrl || this.metadata?.baseUrl || "https://api.openai.com/v1";
            const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

            const headers: Record<string, string> = {
                "Content-Type": "application/json",
            };
            if (apiKey && apiKey !== "none") {
                headers["Authorization"] = `Bearer ${apiKey}`;
            }

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
                    error: `OpenAI API error (${response.status}): ${errorText}`,
                    metadata: {
                        model: config.model,
                        provider: "openai",
                        latencyMs,
                        inferenceAcceleration,
                    },
                };
            }

            const data = await response.json();
            const message = data.choices?.[0]?.message;

            // Native tool calls arrive on the message with content null. Normalize
            // to the {name, args} shape crew and the app builders read (Gemini's
            // functionCall convention), matching what GoogleClient emits.
            const toolCalls = (message?.tool_calls ?? [])
                .filter((tc: any) => tc?.function?.name)
                .map((tc: any) => {
                    let args: Record<string, unknown> = {};
                    const raw = tc.function.arguments;
                    if (raw && typeof raw === "object") args = raw;
                    else if (typeof raw === "string" && raw.trim()) {
                        try { args = JSON.parse(raw); } catch { /* malformed args — execute with {} and let validation repair */ }
                    }
                    return { name: tc.function.name as string, args };
                });

            const outputTokens = data.usage?.completion_tokens ?? 0;
            let mtpEnabled = false;
            let mtpSpeedupPct: number | undefined;
            if (multiTokenPrediction?.enabled === true) {
                mtpEnabled = true;
                const numSpeculativeTokens = inferenceAcceleration?.multiTokenPrediction?.numSpeculativeTokens;
                if (numSpeculativeTokens && outputTokens > 0) {
                    mtpSpeedupPct = (numSpeculativeTokens / (outputTokens + numSpeculativeTokens)) * 100;
                }
            }

            return {
                success: true,
                output: toolCalls.length > 0 ? JSON.stringify({ toolCalls }) : (message?.content || ""),
                metadata: {
                    model: config.model,
                    provider: "openai",
                    tokensUsed: data.usage?.total_tokens,
                    promptTokens: data.usage?.prompt_tokens,
                    completionTokens: data.usage?.completion_tokens,
                    latencyMs,
                    inferenceAcceleration,
                    mtpEnabled,
                    // "length" means tool_call arguments were cut mid-JSON —
                    // callers must treat them as incomplete.
                    finishReason: data.choices?.[0]?.finish_reason,
                    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                    ...(mtpSpeedupPct !== undefined ? { mtpSpeedupPct } : {}),
                },
            };
        } catch (error) {
            const latencyMs = Date.now() - startTime;
            const inferenceAcceleration = buildMultiTokenPredictionMetadata(
                constrainMultiTokenPredictionPassthrough(
                    resolveMultiTokenPrediction(config, this.metadata),
                    Boolean(config.baseUrl || this.metadata?.baseUrl)
                )
            );
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata: {
                    model: config.model,
                    provider: "openai",
                    latencyMs,
                    inferenceAcceleration,
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
            messages.push(...config.messages.map(m => ({
                role: m.role === "model" ? "assistant" : m.role,
                content: m.content
            })));
        } else {
            if (systemPrompt) {
                messages.push({ role: "system", content: systemPrompt });
            }
            messages.push({ role: "user", content: userPrompt });
        }

        const requestBody: any = {
            model: config.model,
            messages,
            temperature: config.temperature ?? 0.7,
            stream: true,
        };

        if (config.adapterPath) {
            requestBody.model = config.adapterPath;
            requestBody.lora_path = config.adapterPath;
                logger.info(`[OpenAIClient] Attaching LoRA adapter (stream): ${config.adapterPath}`);
        }

        if (config.maxTokens) {
            requestBody.max_tokens = config.maxTokens;
        }

        const multiTokenPrediction = constrainMultiTokenPredictionPassthrough(
            resolveMultiTokenPrediction(config, this.metadata),
            Boolean(config.baseUrl || this.metadata?.baseUrl)
        );
        applyMultiTokenPredictionRequestBody(requestBody, multiTokenPrediction);

        const baseUrl = config.baseUrl || this.metadata?.baseUrl || "https://api.openai.com/v1";
        const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };
        if (apiKey && apiKey !== "none") {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }

        const response = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI Stream Error (${response.status}): ${errorText}`);
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
                            console.error("[OpenAI Stream] Failed to parse line:", line);
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }
}


