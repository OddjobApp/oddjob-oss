/**
 * OpenAI Adapter
 * Handles completions for OpenAI models (GPT-4, GPT-3.5)
 */

import { createLogger } from "@server/utils/logger.js";
import type { LLMRequest, LLMResponse, LLMAdapter } from "./types.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("OpenAIAdapter");

export const openAIAdapter: LLMAdapter = {
    name: "openai",

    async complete(request: LLMRequest, model: any, provider: any): Promise<LLMResponse> {
        const startTime = Date.now();
        const apiKey = provider.apiKey || developmentProviderKey("openai");

        if (!apiKey) {
            throw new Error("OpenAI API key not configured");
        }

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: model.modelId,
                messages: request.messages,
                temperature: request.temperature ?? 0.7,
                max_tokens: request.maxTokens ?? 4096,
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`OpenAI API error: ${error}`);
        }

        const data = await response.json();

        // Calculate cost
        const inputTokens = data.usage?.prompt_tokens || 0;
        const outputTokens = data.usage?.completion_tokens || 0;
        const totalTokens = data.usage?.total_tokens || 0;

        const inputCost = (inputTokens / 1000) * (model.inputCostPer1k || provider.defaultInputCostPer1k || 0.03);
        const outputCost = (outputTokens / 1000) * (model.outputCostPer1k || provider.defaultOutputCostPer1k || 0.06);
        const totalCost = inputCost + outputCost;

        return {
            content: data.choices[0]?.message?.content || "",
            model: model.modelId,
            provider: "openai",
            usage: {
                inputTokens,
                outputTokens,
                totalTokens,
                cost: totalCost,
            },
            latency: {
                totalMs: Date.now() - startTime,
            },
            metadata: {
                finishReason: data.choices[0]?.finish_reason,
            },
        };
    },

    async stream(request: LLMRequest, model: any, provider: any, onChunk: (chunk: string) => void): Promise<LLMResponse> {
        const startTime = Date.now();
        const apiKey = provider.apiKey || developmentProviderKey("openai");

        if (!apiKey) {
            throw new Error("OpenAI API key not configured");
        }

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: model.modelId,
                messages: request.messages,
                temperature: request.temperature ?? 0.7,
                max_tokens: request.maxTokens ?? 4096,
                stream: true,
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`OpenAI API error: ${error}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let content = "";

        while (reader) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split("\n").filter(line => line.trim() !== "");

            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const data = line.slice(6);
                    if (data === "[DONE]") continue;

                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta?.content;
                        if (delta) {
                            content += delta;
                            onChunk(delta);
                        }
                    } catch (e) {
                        // Ignore parsing errors for malformed chunks
                    }
                }
            }
        }

        // Estimate tokens (actual tokens not available in streaming)
        const estimatedInputTokens = request.messages.reduce((acc, m) => acc + m.content.length / 4, 0);
        const estimatedOutputTokens = content.length / 4;
        const totalTokens = estimatedInputTokens + estimatedOutputTokens;

        const inputCost = (estimatedInputTokens / 1000) * (model.inputCostPer1k || 0.03);
        const outputCost = (estimatedOutputTokens / 1000) * (model.outputCostPer1k || 0.06);
        const totalCost = inputCost + outputCost;

        return {
            content,
            model: model.modelId,
            provider: "openai",
            usage: {
                inputTokens: Math.round(estimatedInputTokens),
                outputTokens: Math.round(estimatedOutputTokens),
                totalTokens: Math.round(totalTokens),
                cost: totalCost,
            },
            latency: {
                totalMs: Date.now() - startTime,
            },
        };
    },
};
