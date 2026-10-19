/**
 * Anthropic Adapter
 * Handles completions for Anthropic models (Claude 3)
 */

import { createLogger } from "@server/utils/logger.js";
import type { LLMRequest, LLMResponse, LLMAdapter } from "./types.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("AnthropicAdapter");

export const anthropicAdapter: LLMAdapter = {
    name: "anthropic",

    async complete(request: LLMRequest, model: any, provider: any): Promise<LLMResponse> {
        const startTime = Date.now();
        const apiKey = provider.apiKey || developmentProviderKey("anthropic");

        if (!apiKey) {
            throw new Error("Anthropic API key not configured");
        }

        // Convert messages to Anthropic format
        const systemMessage = request.messages.find(m => m.role === "system")?.content;
        const userMessages = request.messages.filter(m => m.role !== "system");

        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: model.modelId,
                messages: userMessages.map(m => ({
                    role: m.role,
                    content: m.content,
                })),
                system: systemMessage,
                max_tokens: request.maxTokens ?? 4096,
                temperature: request.temperature ?? 0.7,
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Anthropic API error: ${error}`);
        }

        const data = await response.json();

        // Calculate cost
        const inputTokens = data.usage?.input_tokens || 0;
        const outputTokens = data.usage?.output_tokens || 0;
        const totalTokens = inputTokens + outputTokens;

        const inputCost = (inputTokens / 1000) * (model.inputCostPer1k || provider.defaultInputCostPer1k || 0.015);
        const outputCost = (outputTokens / 1000) * (model.outputCostPer1k || provider.defaultOutputCostPer1k || 0.075);
        const totalCost = inputCost + outputCost;

        return {
            content: data.content?.[0]?.text || "",
            model: model.modelId,
            provider: "anthropic",
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
                stopReason: data.stop_reason,
            },
        };
    },
};
