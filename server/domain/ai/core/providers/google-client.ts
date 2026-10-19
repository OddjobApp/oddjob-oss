import type { AIApiCallConfig } from "@shared/schema/index.js";
import { AIClient, AIResponse, GeminiFileAttachment, fetchWithRetry, fetchImageAsBase64, normalizeGeminiModel } from "../ai-client.service.js";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";


export class GoogleClient implements AIClient {
    async execute(
        config: AIApiCallConfig,
        input: string | undefined,
        apiKey: string,
        fileAttachments?: GeminiFileAttachment[],
        _traceContext?: TraceContext
    ): Promise<AIResponse> {
        const startTime = Date.now();
        const model = normalizeGeminiModel(config.model || "gemini-2.5-flash");

        try {
            // Start of updated execute block
            const userPrompt = config.userPrompt;
            const systemPrompt = config.systemPrompt;

            // 1. Build contents from config.messages OR legacy user/system prompt
            let contents: any[] = [];
            
            if (config.messages && config.messages.length > 0) {
                contents = config.messages.map(m => {
                    const role = m.role === "system" ? "user" : (["model", "assistant"].includes(m.role) ? "model" : "user");
                    const parts = Array.isArray(m.content) ? m.content : [{ text: m.content }];
                    return { role, parts };
                });
            } else {
                // If using cached context, the system prompt is already baked into the cache.
                const combinedPrompt = (systemPrompt && !config.cachedContentName)
                    ? `${systemPrompt}\n\n${userPrompt}`
                    : userPrompt;
                
                const parts: any[] = [{ text: combinedPrompt }];
                if (fileAttachments && fileAttachments.length > 0) {
                    fileAttachments.forEach(({ fileUri, mimeType }) => {
                        if (fileUri) {
                            parts.push({
                                fileData: {
                                    fileUri,
                                    mimeType: mimeType || "application/octet-stream",
                                },
                            });
                        }
                    });
                }
                contents = [{ role: "user", parts }];
            }

            // 2. Handle URL Attachments (Multi-Modal) if messages weren't used
            if (!config.messages && config.attachments && config.attachments.length > 0) {
                const firstUserParts = contents[0].parts;
                await Promise.all(config.attachments.map(async (att) => {
                    if (att.type === 'image_url') {
                        try {
                            const { data, mimeType } = await fetchImageAsBase64(att.url);
                            firstUserParts.push({
                                inlineData: { mimeType, data }
                            });
                        } catch (e) {
                            console.error(`[Google Client] Failed to process image attachment ${att.url}:`, e);
                            throw new Error(`Failed to process attachment ${att.url}: ${e}`);
                        }
                    }
                }));
            }

            const requestBody: any = {
                contents,
                generationConfig: {
                    temperature: config.temperature ?? 0.7,
                },
            };

            if (config.cachedContentName) {
                requestBody.cachedContent = config.cachedContentName;
            }

            // 3. Attach Tools if present
            if (config.tools && config.tools.length > 0) {
                requestBody.tools = [{
                    functionDeclarations: config.tools.map(t => ({
                        name: t.name,
                        description: t.description,
                        parameters: t.inputSchema || t.parameters || { type: "object", properties: {}, required: [] }
                    }))
                }];
            } else if (config.requestType === "json") {
                requestBody.generationConfig.responseMimeType = "application/json";
                // Disable the model's "thinking" budget for structured JSON requests.
                // gemini-2.5-* are thinking models: left on, the reasoning trace both
                // (a) consumes the output-token budget and truncates the JSON, and
                // (b) can surface as a separate text part that gets grabbed instead of
                // the answer (we saw planning output start with "thought_process...").
                // Spend the output tokens on the JSON itself.
                requestBody.generationConfig.thinkingConfig = { thinkingBudget: 0 };
            }

            if (config.maxTokens) {
                requestBody.generationConfig.maxOutputTokens = config.maxTokens;
            }

            // Explicit thinking budget for plain-text requests. Same reasoning as
            // the JSON branch above: on a thinking model the reasoning trace eats
            // maxOutputTokens and truncates the answer mid-sentence. Callers that
            // want the budget spent on the answer pass thinkingBudget: 0.
            if (config.thinkingBudget !== undefined) {
                requestBody.generationConfig.thinkingConfig = { thinkingBudget: config.thinkingBudget };
            }

            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
            const response = await fetchWithRetry(apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
                body: JSON.stringify(requestBody),
            });

            const latencyMs = Date.now() - startTime;

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[Google Client] API Error (${response.status})`);
                return {
                    success: false,
                    error: `Gemini request failed (HTTP ${response.status}). Check your organization key, quota, and model access.`,
                    metadata: { model, provider: "google", latencyMs },
                };
            }

            const data = await response.json();
            const candidate = data.candidates?.[0];
            const candidateParts = candidate?.content?.parts || [];
            
            const toolCalls = candidateParts.filter((p: any) => p.functionCall);
            // Concatenate every answer text part, skipping any "thought" parts a
            // gemini-2.5 thinking model may emit. Previously this took only the FIRST
            // text part, which grabbed the reasoning trace (e.g. "thought_process...")
            // instead of the JSON answer, and dropped JSON that spanned multiple parts.
            const textOutput = candidateParts
                .filter((p: any) => typeof p.text === "string" && !p.thought)
                .map((p: any) => p.text)
                .join("");

            return {
                success: true,
                output: toolCalls.length > 0 ? JSON.stringify({ toolCalls }) : textOutput,
                metadata: {
                    model,
                    provider: "google",
                    tokensUsed: data.usageMetadata?.totalTokenCount,
                    promptTokens: data.usageMetadata?.promptTokenCount,
                    completionTokens: data.usageMetadata?.candidatesTokenCount,
                    latencyMs,
                    // "MAX_TOKENS" means the functionCall args were cut
                    // mid-write — callers must treat them as incomplete.
                    finishReason: candidate?.finishReason,
                    toolCalls: toolCalls.length > 0 ? toolCalls.map((tc: any) => tc.functionCall) : undefined
                },
            };
        } catch (error) {
            const latencyMs = Date.now() - startTime;
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata: {
                    model,
                    provider: "google",
                    latencyMs,
                },
            };
        }
    }

    async *executeStream(
        config: AIApiCallConfig,
        _input: string | undefined,
        apiKey: string,
        fileAttachments?: GeminiFileAttachment[],
        _traceContext?: TraceContext
    ): AsyncIterable<string> {
        const model = normalizeGeminiModel(config.model || "gemini-2.0-flash");
        const userPrompt = config.userPrompt;
        const systemPrompt = config.systemPrompt;
        const combinedPrompt = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;
        const parts: any[] = [{ text: combinedPrompt }];

        if (fileAttachments?.length) {
            fileAttachments.forEach(({ fileUri, mimeType }) => {
                if (fileUri) parts.push({ fileData: { fileUri, mimeType: mimeType || "application/octet-stream" } });
            });
        }

        const requestBody: any = {
            contents: [{ role: "user", parts }],
            generationConfig: { temperature: config.temperature ?? 0.7 },
        };

        if (config.cachedContentName) {
            requestBody.cachedContent = config.cachedContentName;
        }

        if (config.requestType === "json") requestBody.generationConfig.responseMimeType = "application/json";
        if (config.maxTokens) requestBody.generationConfig = requestBody.generationConfig || {};
        if (config.maxTokens) requestBody.generationConfig.maxOutputTokens = config.maxTokens;

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
        const res = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify(requestBody),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Google stream error (${res.status}): ${err}`);
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() || "";
            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const json = line.slice(6);
                    if (json === "[DONE]" || json === "") continue;
                    try {
                        const obj = JSON.parse(json);
                        const text = obj.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (text) yield text;
                    } catch {
                        // skip malformed chunk
                    }
                }
            }
        }
    }

    async createContextCache(
        config: AIApiCallConfig,
        input: string,
        apiKey: string,
        ttlSeconds: number = 3600
    ): Promise<{ cacheName: string }> {
        const model = normalizeGeminiModel(config.model || "gemini-1.5-pro-001");
        const cacheModel = model.startsWith("models/") ? model : `models/${model}`;

        const systemInstruction = config.systemPrompt ? {
            parts: [{ text: config.systemPrompt }]
        } : undefined;

        const requestBody = {
            model: cacheModel,
            contents: [{ role: "user", parts: [{ text: input }] }],
            ttl: `${ttlSeconds}s`,
            ...(systemInstruction ? { systemInstruction } : {})
        };

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/cachedContents`;
        const response = await fetchWithRetry(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Google Cache API error (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        return { cacheName: data.name };
    }
}


