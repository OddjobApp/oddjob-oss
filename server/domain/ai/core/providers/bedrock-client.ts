import type { AIApiCallConfig } from "@shared/schema/index.js";
import { AIClient, AIResponse, GeminiFileAttachment, fetchWithRetry, fetchImageAsBase64 } from "../ai-client.service.js";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";

/**
 * Amazon Bedrock through the Converse API, authenticated with a Bedrock API key
 * as a bearer token, so no AWS SDK or SigV4 signing is needed. Converse is the
 * one request shape every Bedrock text model accepts (Nova, Claude, Llama, ...).
 *
 * The endpoint is the connection's region from ORG_AI_PROVIDERS, never a URL
 * the caller supplies.
 */

type ConverseBlock =
    | { text: string }
    | { image: { format: string; source: { bytes: string } } }
    | { toolUse: { toolUseId: string; name: string; input: unknown } };

/** Claude 5-generation models reject `temperature`, as on Anthropic's own API. */
function samplingParamsDeprecated(model: string): boolean {
    return /anthropic\.claude-[a-z]+-5(?:[-.:]|$)/.test(model);
}

/** Converse wants alternating user/assistant turns with non-empty content. */
function toConverseMessages(messages: AIApiCallConfig["messages"]): Array<{ role: "user" | "assistant"; content: ConverseBlock[] }> {
    const out: Array<{ role: "user" | "assistant"; content: ConverseBlock[] }> = [];
    for (const m of messages ?? []) {
        if (m.role === "system") continue;
        const role = m.role === "model" || (m.role as string) === "assistant" ? "assistant" : "user";
        const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        if (!text || !text.trim()) continue;
        const last = out[out.length - 1];
        if (last && last.role === role) last.content.push({ text });
        else out.push({ role, content: [{ text }] });
    }
    return out;
}

/** Crew declarations carry `inputSchema` or `parameters`; Converse wants `toolSpec.inputSchema.json`. */
function toConverseTools(config: AIApiCallConfig) {
    const declared = (config as any).tools;
    if (!Array.isArray(declared)) return [];
    return declared
        .filter((t: any) => t && typeof t.name === "string")
        .map((t: any) => ({
            toolSpec: {
                name: t.name,
                description: typeof t.description === "string" && t.description ? t.description : t.name,
                inputSchema: {
                    json: (t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : null) ??
                        (t.parameters && typeof t.parameters === "object" ? t.parameters : { type: "object", properties: {} }),
                },
            },
        }));
}

const IMAGE_FORMATS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpeg", "image/jpg": "jpeg", "image/gif": "gif", "image/webp": "webp" };

export class BedrockClient implements AIClient {
    constructor(private readonly baseUrl?: string) {}

    async execute(
        config: AIApiCallConfig,
        _input: string | undefined,
        apiKey: string,
        _fileAttachments?: GeminiFileAttachment[],
        _traceContext?: TraceContext
    ): Promise<AIResponse> {
        const startTime = Date.now();
        const failure = (error: string): AIResponse => ({
            success: false, error, metadata: { model: config.model, provider: "bedrock", latencyMs: Date.now() - startTime },
        });
        if (!this.baseUrl) return failure("Amazon Bedrock needs a region; reconnect it in Organization Settings");
        if (!apiKey) return failure("Amazon Bedrock needs the organization's Bedrock API key");

        try {
            let system = config.systemPrompt;
            let messages: Array<{ role: "user" | "assistant"; content: ConverseBlock[] }>;

            if (config.messages && config.messages.length > 0) {
                const sysMsg = config.messages.find(m => m.role === "system");
                if (sysMsg) system = typeof sysMsg.content === "string" ? sysMsg.content : JSON.stringify(sysMsg.content);
                messages = toConverseMessages(config.messages);
            } else {
                const content: ConverseBlock[] = [{ text: config.userPrompt ?? "" }];
                for (const att of config.attachments ?? []) {
                    if (att.type !== "image_url") continue;
                    const { data, mimeType } = await fetchImageAsBase64(att.url);
                    const format = IMAGE_FORMATS[mimeType.toLowerCase()];
                    if (!format) throw new Error(`Amazon Bedrock does not accept ${mimeType} images`);
                    content.push({ image: { format, source: { bytes: data } } });
                }
                messages = [{ role: "user", content }];
            }

            const isJsonMode = config.requestType === "json";
            if (isJsonMode) {
                const jsonDirective = "CRITICAL: You must return ONLY a single valid JSON object starting with '{' and ending with '}'. Do not wrap in markdown (no ```json or ```). Do not include any explanations, prose, or preamble.";
                system = system ? `${system}\n\n${jsonDirective}` : jsonDirective;
            }

            const inferenceConfig: Record<string, number> = { maxTokens: config.maxTokens || 1024 };
            if (!samplingParamsDeprecated(config.model)) inferenceConfig.temperature = config.temperature ?? 0.7;

            const body: Record<string, unknown> = { messages, inferenceConfig };
            if (system) body.system = [{ text: system }];
            const tools = toConverseTools(config);
            if (tools.length) body.toolConfig = { tools, toolChoice: { auto: {} } };

            const response = await fetchWithRetry(`${this.baseUrl}/model/${encodeURIComponent(config.model)}/converse`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                return failure(`Amazon Bedrock API error (${response.status}): ${await response.text()}`);
            }

            const data = await response.json();
            const blocks: any[] = Array.isArray(data.output?.message?.content) ? data.output.message.content : [];
            let output = blocks.filter(b => typeof b?.text === "string").map(b => b.text).join("");
            if (isJsonMode) {
                const mdMatch = output.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
                if (mdMatch) output = mdMatch[1].trim();
            }
            const toolCalls = blocks.filter(b => b?.toolUse).map(b => ({ name: b.toolUse.name, args: b.toolUse.input ?? {} }));

            return {
                success: true,
                output,
                metadata: {
                    model: config.model,
                    provider: "bedrock",
                    tokensUsed: data.usage?.totalTokens ?? 0,
                    promptTokens: data.usage?.inputTokens ?? 0,
                    completionTokens: data.usage?.outputTokens ?? 0,
                    toolCalls,
                    // "max_tokens" means a toolUse input may be cut short.
                    stopReason: data.stopReason,
                    latencyMs: Date.now() - startTime,
                },
            };
        } catch (error) {
            return failure(error instanceof Error ? error.message : String(error));
        }
    }
}
