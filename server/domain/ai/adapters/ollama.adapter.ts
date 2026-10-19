/**
 * Ollama & Local vLLM Adapter
 * Handles chat completions and streaming for open-weight models (Hermes 3, DeepSeek-R1, Qwen 2.5, Llama 3.3).
 * Extracts reasoning tags (<THINKING>...</THINKING>, <PLAN>...</PLAN>) in real time.
 */

import { createLogger } from "@server/utils/logger.js";
import type { LLMRequest, LLMResponse, LLMAdapter } from "./types.js";

const logger = createLogger("OllamaAdapter");

export interface ReasoningExtractionResult {
    rawContent: string;
    thinking?: string;
    plan?: string;
    cleanContent: string;
}

export function extractReasoningTokens(content: string): ReasoningExtractionResult {
    let thinking: string | undefined;
    let plan: string | undefined;
    let cleanContent = content;

    const thinkMatch = content.match(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/i);
    if (thinkMatch) {
        thinking = thinkMatch[1].trim();
        cleanContent = cleanContent.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/i, "").trim();
    }

    const planMatch = content.match(/<plan>([\s\S]*?)<\/plan>/i);
    if (planMatch) {
        plan = planMatch[1].trim();
        cleanContent = cleanContent.replace(/<plan>[\s\S]*?<\/plan>/i, "").trim();
    }

    return {
        rawContent: content,
        thinking,
        plan,
        cleanContent,
    };
}

export const ollamaAdapter: LLMAdapter = {
    name: "ollama",

    async complete(request: LLMRequest, model: any = {}, provider: any = {}): Promise<LLMResponse> {
        const startTime = Date.now();
        const baseUrl = provider?.baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434";
        const modelId = model?.modelId || request.preferredModel || "qwen2.5-coder:7b";

        const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: modelId,
                messages: request.messages,
                stream: false,
                options: {
                    temperature: request.temperature ?? 0.6,
                    num_predict: request.maxTokens ?? 4096,
                },
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ollama API error (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        const rawContent = data.message?.content || "";
        const extraction = extractReasoningTokens(rawContent);

        const promptEvalCount = data.prompt_eval_count || 0;
        const evalCount = data.eval_count || 0;

        return {
            content: extraction.cleanContent,
            model: modelId,
            provider: "ollama",
            usage: {
                inputTokens: promptEvalCount,
                outputTokens: evalCount,
                totalTokens: promptEvalCount + evalCount,
                cost: 0.0, // Open-weight / local models are cost-free
            },
            latency: {
                totalMs: Date.now() - startTime,
            },
            metadata: {
                rawContent,
                thinking: extraction.thinking,
                plan: extraction.plan,
                doneReason: data.done_reason || "stop",
            },
        };
    },

    async stream(
        request: LLMRequest,
        model: any = {},
        provider: any = {},
        onChunk: (chunk: string) => void
    ): Promise<LLMResponse> {
        const startTime = Date.now();
        const baseUrl = provider?.baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434";
        const modelId = model?.modelId || request.preferredModel || "qwen2.5-coder:7b";

        const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: modelId,
                messages: request.messages,
                stream: true,
                options: {
                    temperature: request.temperature ?? 0.6,
                    num_predict: request.maxTokens ?? 4096,
                },
            }),
        });

        if (!response.ok || !response.body) {
            const errorText = await response.text();
            throw new Error(`Ollama streaming error (${response.status}): ${errorText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedRaw = "";
        let promptEvalCount = 0;
        let evalCount = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const textChunk = decoder.decode(value, { stream: true });
            const lines = textChunk.split("\n").filter((l) => l.trim().length > 0);

            for (const line of lines) {
                try {
                    const parsed = JSON.parse(line);
                    const token = parsed.message?.content || "";
                    if (token) {
                        accumulatedRaw += token;
                        onChunk(token);
                    }
                    if (parsed.prompt_eval_count) promptEvalCount = parsed.prompt_eval_count;
                    if (parsed.eval_count) evalCount = parsed.eval_count;
                } catch {
                    // Ignore transient non-JSON streaming chunks
                }
            }
        }

        const extraction = extractReasoningTokens(accumulatedRaw);

        return {
            content: extraction.cleanContent,
            model: modelId,
            provider: "ollama",
            usage: {
                inputTokens: promptEvalCount,
                outputTokens: evalCount,
                totalTokens: promptEvalCount + evalCount,
                cost: 0.0,
            },
            latency: {
                totalMs: Date.now() - startTime,
            },
            metadata: {
                rawContent: accumulatedRaw,
                thinking: extraction.thinking,
                plan: extraction.plan,
            },
        };
    },
};
