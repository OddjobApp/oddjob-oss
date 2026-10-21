import type { AIApiCallConfig } from "@shared/schema/index.js";
import { AIClient, AIResponse, GeminiFileAttachment, fetchWithRetry, fetchImageAsBase64 } from "../ai-client.service.js";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";

/**
 * Claude 5-generation models (claude-opus-5-5, claude-sonnet-5-5,
 * claude-fable-5-1, claude-opus-5) reject `temperature` with a 400 — the field
 * is deprecated for them. Detect by the family-5 prefix; gen-4 ids like
 * claude-sonnet-4-5 still accept it, so the match must not catch the "-4-5"
 * suffix.
 */
function samplingParamsDeprecated(model: string): boolean {
    return /^claude-(?:opus|sonnet|haiku|fable)-5(?:-|$)/.test(claudeModelName(model));
}

/** The Anthropic model name inside a Bedrock ID: us.anthropic.claude-x-v1:0 -> claude-x. */
function claudeModelName(model: string): string {
    return model.replace(/^(?:[a-z]+\.)?anthropic\./, "").replace(/-v\d+(?::\d+)?$/, "");
}

/** Where a Messages request goes and how it is authenticated. */
export interface AnthropicTransport {
    provider: string;
    label: string;
    url(model: string): string;
    headers(apiKey: string): Record<string, string>;
    body(request: Record<string, unknown>): Record<string, unknown>;
}

export const ANTHROPIC_DIRECT: AnthropicTransport = {
    provider: "anthropic",
    label: "Anthropic",
    url: () => "https://api.anthropic.com/v1/messages",
    headers: apiKey => ({ "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }),
    body: request => request,
};

/**
 * The same Messages body on Amazon Bedrock's InvokeModel: the model moves into
 * the path, the API version into the body, and a Bedrock API key authenticates.
 * `runtimeUrl` comes from the provider registry, never from a caller.
 */
export function bedrockTransport(runtimeUrl: string): AnthropicTransport {
    return {
        provider: "bedrock",
        label: "Amazon Bedrock",
        url: model => `${runtimeUrl}/model/${encodeURIComponent(model)}/invoke`,
        headers: apiKey => ({ "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }),
        body: ({ model: _model, stream: _stream, ...rest }) => ({ anthropic_version: "bedrock-2023-05-31", ...rest }),
    };
}

/**
 * Anthropic accepts only alternating user/assistant turns and rejects empty
 * content — a turn whose entire response was tool calls arrives as "". Map
 * roles, drop empties, and merge consecutive same-role messages.
 */
function normalizeAnthropicMessages(messages: AIApiCallConfig["messages"]): Array<{ role: "user" | "assistant"; content: string }> {
    const out: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const m of messages ?? []) {
        if (m.role === "system") continue;
        const role = m.role === "model" || (m.role as string) === "assistant" ? "assistant" : "user";
        const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        if (!content || !content.trim()) continue;
        const last = out[out.length - 1];
        if (last && last.role === role) last.content += `\n\n${content}`;
        else out.push({ role, content });
    }
    return out;
}

/**
 * Crew function declarations carry both `parameters` and `inputSchema` (the
 * same JSON Schema object); Anthropic's field is `input_schema`.
 */
function toAnthropicTools(config: AIApiCallConfig): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
    const declared = (config as any).tools;
    if (!Array.isArray(declared)) return [];
    return declared
        .filter((t: any) => t && typeof t.name === "string")
        .map((t: any) => ({
            name: t.name,
            description: typeof t.description === "string" ? t.description : "",
            input_schema:
                (t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : null) ??
                (t.parameters && typeof t.parameters === "object" ? t.parameters : { type: "object", properties: {} }),
        }));
}

export class AnthropicClient implements AIClient {
    constructor(private readonly transport: AnthropicTransport = ANTHROPIC_DIRECT) {}

    async execute(
        config: AIApiCallConfig,
        input: string | undefined,
        apiKey: string,
        _fileAttachments?: GeminiFileAttachment[],
        _traceContext?: TraceContext
    ): Promise<AIResponse> {
        const startTime = Date.now();

        try {
            // Send prompts exactly as configured - no {{input}} substitution
            const userPrompt = config.userPrompt;
            const systemPrompt = config.systemPrompt;

            // Debug: Log prompt details
            console.log('[Anthropic Client] User prompt length:', userPrompt?.length ?? 0);
            if (userPrompt?.includes('---')) {
                console.log('[Anthropic Client] RAG context detected in prompt');
            }

            let system = systemPrompt;
            let messages: any[] = [];

            if (config.messages && config.messages.length > 0) {
                const sysMsg = config.messages.find(m => m.role === "system");
                if (sysMsg) {
                    system = typeof sysMsg.content === 'string' ? sysMsg.content : JSON.stringify(sysMsg.content);
                }
                messages = normalizeAnthropicMessages(config.messages);
            } else {
                const userContent: any[] = [{ type: "text", text: userPrompt ?? "" }];

                // Handle Attachments (Multi-Modal)
                if (config.attachments && config.attachments.length > 0) {
                    console.log(`[Anthropic Client] Processing ${config.attachments.length} URL attachments...`);
                    await Promise.all(config.attachments.map(async (att) => {
                        if (att.type === 'image_url') {
                            try {
                                const { data, mimeType } = await fetchImageAsBase64(att.url);
                                userContent.push({
                                    type: "image",
                                    source: {
                                        type: "base64",
                                        media_type: mimeType,
                                        data: data
                                    }
                                });
                            } catch (e) {
                                console.error(`[Anthropic Client] Failed to process image attachment ${att.url}:`, e);
                                throw new Error(`Failed to process attachment ${att.url}: ${e}`);
                            }
                        }
                    }));
                }

                messages.push({ role: "user", content: userContent });
            }

            const isJsonMode = config.requestType === "json";
            if (isJsonMode) {
                const jsonDirective = "CRITICAL: You must return ONLY a single valid JSON object starting with '{' and ending with '}'. Do not wrap in markdown (no ```json or ```). Do not include any explanations, prose, or preamble.";
                system = system ? `${system}\n\n${jsonDirective}` : jsonDirective;
            }

            // Native function calling: crew declarations arrive as
            // { name, description, inputSchema | parameters } — Anthropic wants
            // input_schema. tool_use blocks come back in the content array.
            const tools = toAnthropicTools(config);

            let prefilledJson = false;
            if (isJsonMode && tools.length === 0 && messages.length > 0 && messages[messages.length - 1].role === "user") {
                messages.push({ role: "assistant", content: "{" });
                prefilledJson = true;
            }

            const requestBody: any = {
                model: config.model,
                max_tokens: config.maxTokens || 1024,
                messages,
            };
            if (!samplingParamsDeprecated(config.model)) {
                requestBody.temperature = config.temperature ?? 0.7;
            }

            // Claude 5.x models think adaptively and thinking tokens count
            // against max_tokens — under a small budget the response can be a
            // lone thinking block, which parses back as empty content. The API
            // rejects thinking.type.disabled on 5.x; effort "low" is the
            // supported equivalent of the crew's thinkingBudget: 0.
            if (samplingParamsDeprecated(config.model) && config.thinkingBudget === 0) {
                requestBody.output_config = { effort: "low" };
            }

            if (system) {
                requestBody.system = system;
            }

            if (tools.length) {
                requestBody.tools = tools;
                requestBody.tool_choice = { type: "auto" };
            }

            const response = await fetchWithRetry(this.transport.url(config.model), {
                method: "POST",
                headers: this.transport.headers(apiKey),
                body: JSON.stringify(this.transport.body(requestBody)),
            });

            const latencyMs = Date.now() - startTime;

            if (!response.ok) {
                const errorText = await response.text();
                return {
                    success: false,
                    error: `${this.transport.label} API error (${response.status}): ${errorText}`,
                    metadata: {
                        model: config.model,
                        provider: this.transport.provider,
                        latencyMs,
                    },
                };
            }

            const data = await response.json();

            const blocks: any[] = Array.isArray(data.content) ? data.content : [];
            let output = blocks
                .filter((b) => b?.type === "text")
                .map((b) => b.text ?? "")
                .join("");
            if (prefilledJson) {
                output = "{" + output;
            }
            if (isJsonMode) {
                const trimmed = output.trim();
                const mdMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
                if (mdMatch) {
                    output = mdMatch[1].trim();
                }
            }
            const toolCalls = blocks
                .filter((b) => b?.type === "tool_use")
                .map((b) => ({ name: b.name, args: b.input ?? {} }));

            return {
                success: true,
                output,
                metadata: {
                    model: config.model,
                    provider: this.transport.provider,
                    tokensUsed: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
                    promptTokens: data.usage?.input_tokens ?? 0,
                    completionTokens: data.usage?.output_tokens ?? 0,
                    toolCalls,
                    // "max_tokens" means a tool_use input was cut mid-JSON —
                    // Anthropic returns the keys that parsed and drops the
                    // rest. Callers must treat those args as incomplete.
                    stopReason: data.stop_reason,
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
                    provider: this.transport.provider,
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
        // Bedrock streams in AWS event-stream framing, not SSE. Organization calls
        // never stream (OrganizationAIClient meters one complete response), so
        // answer in one chunk rather than parse a second wire format.
        if (this.transport !== ANTHROPIC_DIRECT) {
            const response = await this.execute(config, input, apiKey, _fileAttachments, _traceContext);
            if (!response.success) throw new Error(response.error || `${this.transport.label} request failed`);
            if (response.output) yield response.output;
            return;
        }
        const userPrompt = config.userPrompt;
        const systemPrompt = config.systemPrompt;

        const requestBody: any = {
            model: config.model,
            max_tokens: config.maxTokens || 1024,
            messages: [],
            stream: true,
        };
        if (!samplingParamsDeprecated(config.model)) {
            requestBody.temperature = config.temperature ?? 0.7;
        }
        if (samplingParamsDeprecated(config.model) && config.thinkingBudget === 0) {
            requestBody.output_config = { effort: "low" };
        }

        let system = systemPrompt;
        let messages: any[] = [];

        if (config.messages && config.messages.length > 0) {
            const sysMsg = config.messages.find(m => m.role === "system");
            if (sysMsg) {
                system = typeof sysMsg.content === 'string' ? sysMsg.content : JSON.stringify(sysMsg.content);
            }
            messages = normalizeAnthropicMessages(config.messages);
        } else {
            messages = [{ role: "user", content: userPrompt ?? "" }];
        }

        const isJsonMode = config.requestType === "json";
        if (isJsonMode) {
            const jsonDirective = "CRITICAL: You must return ONLY a single valid JSON object starting with '{' and ending with '}'. Do not wrap in markdown (no ```json or ```). Do not include any explanations, prose, or preamble.";
            system = system ? `${system}\n\n${jsonDirective}` : jsonDirective;
        }

        // Same prefill as the non-stream path: the model continues the object
        // instead of emitting prose or a markdown fence. The "{" is yielded to
        // the consumer as the first chunk so the assembled stream matches what
        // execute() returns.
        const prefilledJson =
            isJsonMode && messages.length > 0 && messages[messages.length - 1].role === "user";
        if (prefilledJson) {
            messages.push({ role: "assistant", content: "{" });
        }

        if (system) {
            requestBody.system = system;
        }
        requestBody.messages = messages;

        const response = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Anthropic Stream Error (${response.status}): ${errorText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) return;

        if (prefilledJson) {
            yield "{";
        }

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
                    if (line.trim() === "") continue;
                    if (line.startsWith("data: ")) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.type === "content_block_delta" && data.delta?.text) {
                                yield data.delta.text;
                            }
                        } catch (e) {
                            // Ignore non-JSON lines or other event formats
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }
}


