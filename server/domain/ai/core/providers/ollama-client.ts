import type { AIApiCallConfig } from "@shared/schema/index.js";
import { AIClient, AIResponse, GeminiFileAttachment, fetchWithRetry } from "../ai-client.service.js";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("OllamaClient");

export class OllamaClient implements AIClient {
    constructor(private metadata: { baseUrl: string; model?: string }) { }

    async execute(
        config: AIApiCallConfig,
        input: string | undefined,
        apiKey: string, // Unused for local Ollama usually
        fileAttachments?: GeminiFileAttachment[],
        _traceContext?: TraceContext,
        onHeartbeat?: (metrics: { elapsedMs: number; status: string }) => void
    ): Promise<AIResponse> {
        const startTime = Date.now();
        let heartbeatInterval: NodeJS.Timeout | undefined;

        if (onHeartbeat) {
            heartbeatInterval = setInterval(() => {
                onHeartbeat({
                    elapsedMs: Date.now() - startTime,
                    status: 'reasoning'
                });
            }, 5000);
        }

        try {
            // Use configured model or fallback to metadata default or hard default
            const model = config.model || this.metadata.model || "llama3.2";
            const baseUrl = this.metadata.baseUrl.replace(/\/$/, "");

            console.log(`[Ollama Client] Sending prompt to ${baseUrl} with model ${model}`);

            // Prepare messages
            const messages: Array<{ role: string; content: string }> = [];

            let finalSystemPrompt = config.systemPrompt || "";
            if (config.systemPromptAddition) {
                finalSystemPrompt = finalSystemPrompt
                    ? `${finalSystemPrompt}\n${config.systemPromptAddition}`
                    : config.systemPromptAddition;
            }

            if (finalSystemPrompt) {
                messages.push({ role: "system", content: finalSystemPrompt });
            }

            // Handle config.messages if present (modern API) or fall back to userPrompt
            if (config.messages && config.messages.length > 0) {
                config.messages.forEach(m => {
                    if (m.role !== 'system') {
                        messages.push({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
                    }
                });
            } else {
                messages.push({ role: "user", content: config.userPrompt });
            }

            const requestBody: any = {
                model,
                messages,
                stream: false,
                options: {
                    temperature: config.temperature ?? 0.7,
                    num_predict: config.maxTokens,
                    num_ctx: (this.metadata as any).numCtx || (config as any).maxContextTokens || 32768,
                    use_flash_attention: true,
                    top_k: (config as any).topK || 40,
                    top_p: (config as any).topP || 0.9,
                    repeat_penalty: (config as any).repeatPenalty || 1.1,
                },
                format: config.requestType === "json" ? "json" : undefined,
            };

            // Apply speculative decoding if supported
            try {
                const { LocalSpeculativeService } = await import("../local-speculative.service.js");
                const profile = process.env.DEPLOYMENT_PROFILE || "workstation";
                LocalSpeculativeService.applySpeculation(requestBody, model, profile);
            } catch (specErr) {
                logger.warn(`[OllamaClient] Failed to apply speculative decoding: ${specErr instanceof Error ? specErr.message : String(specErr)}`);
            }

            // Student LLM Adapter routing (custom param for vLLM/Ollama wrapper)
            if ((config as any).adapterPath) {
                requestBody.lora_adapter = (config as any).adapterPath;
                logger.info(`[OllamaClient] Attaching LoRA adapter: ${(config as any).adapterPath}`);
            }

            // Attach Tools if present (Ollama v0.1.34+)
            if (config.tools && config.tools.length > 0) {
                requestBody.tools = config.tools.map(t => ({
                    type: "function",
                    function: {
                        name: t.name,
                        description: t.description,
                        parameters: t.inputSchema || t.parameters || { type: "object", properties: {}, required: [] }
                    }
                }));
            }

            const response = await fetchWithRetry(`${baseUrl}/api/chat`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(requestBody),
            });

            const latencyMs = Date.now() - startTime;

            if (!response.ok) {
                const errorText = await response.text();
                return {
                    success: false,
                    error: `Ollama API error (${response.status}): ${errorText}`,
                    metadata: {
                        model,
                        provider: "ollama",
                        latencyMs,
                    },
                };
            }

            const data = await response.json();
            const message = data.message;
            
            // Extract native tool calls if present
            const toolCalls = message?.tool_calls?.filter((tc: any) => typeof tc.function?.name === 'string').map((tc: any) => {
                let args: Record<string, unknown> = {};
                const raw = tc.function.arguments;
                if (raw && typeof raw === 'object' && !Array.isArray(raw)) args = raw;
                else if (typeof raw === 'string') {
                    try {
                        const parsed = JSON.parse(raw);
                        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
                    } catch { /* Preserve the call for tool validation and repair. */ }
                }
                // Match Google/OpenAI's canonical args envelope. Retain the
                // legacy alias for consumers of serialized Ollama output.
                return { name: tc.function.name, args, arguments: args };
            });

            return {
                success: true,
                output: toolCalls?.length > 0 ? JSON.stringify({ toolCalls }) : (message?.content || ""),
                metadata: {
                    model,
                    provider: "ollama",
                    tokensUsed: data.eval_count,
                    promptTokens: data.prompt_eval_count,
                    completionTokens: data.eval_count,
                    latencyMs,
                    toolCalls: toolCalls?.length > 0 ? toolCalls : undefined
                },
            };
        } catch (error) {
            const latencyMs = Date.now() - startTime;
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                metadata: {
                    model: config.model,
                    provider: "ollama",
                    latencyMs,
                },
            };
        } finally {
            if (heartbeatInterval) clearInterval(heartbeatInterval);
        }
    }

    async *executeStream(
        config: AIApiCallConfig,
        input: string | undefined,
        apiKey: string,
        fileAttachments?: GeminiFileAttachment[],
        _traceContext?: TraceContext
      ): AsyncIterable<string> {
        const model = config.model || this.metadata.model || "llama3.2";
        const baseUrl = this.metadata.baseUrl.replace(/\/$/, "");
    
        const messages: Array<{ role: string; content: string }> = [];
        let finalSystemPrompt = config.systemPrompt || "";
        if (config.systemPromptAddition) {
          finalSystemPrompt = finalSystemPrompt
            ? `${finalSystemPrompt}\n${config.systemPromptAddition}`
            : config.systemPromptAddition;
        }
        if (finalSystemPrompt) {
          messages.push({ role: "system", content: finalSystemPrompt });
        }
    
        if (config.messages && config.messages.length > 0) {
          config.messages.forEach(m => {
            if (m.role !== 'system') {
              messages.push({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
            }
          });
        } else {
          messages.push({ role: "user", content: config.userPrompt });
        }
    
        const requestBody = {
          model,
          messages,
          stream: true,
          options: {
            temperature: config.temperature ?? 0.7,
            num_predict: config.maxTokens,
            num_ctx: (this.metadata as any).numCtx || (config as any).maxContextTokens || 32768,
          },
        };
    
        const response = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
    
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Ollama Stream Error (${response.status}): ${errorText}`);
        }
    
        const reader = response.body?.getReader();
        if (!reader) return;
    
        const decoder = new TextDecoder();
        let buffer = "";
    
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
    
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
    
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const data = JSON.parse(line);
                if (data.message?.content) {
                  yield data.message.content;
                }
              } catch (e) {
                console.error("[Ollama Stream] Failed to parse line:", line);
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      }
}
