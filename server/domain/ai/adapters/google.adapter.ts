/**
 * Google Gemini Adapter
 * Handles completions for Google Gemini models
 */

import { createLogger } from "@server/utils/logger.js";
import type { LLMRequest, LLMResponse, LLMAdapter } from "./types.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("GoogleAdapter");

export const googleAdapter: LLMAdapter = {
    name: "google",

    async complete(request: LLMRequest, model: any, provider: any): Promise<LLMResponse> {
        const startTime = Date.now();
        const apiKey = provider.apiKey || developmentProviderKey();

        if (!apiKey) {
            throw new Error("Google API key not configured");
        }

        // Convert messages to Gemini format
        const contents = request.messages.map(m => ({
            role: m.role === "assistant" ? "model" : m.role,
            parts: [{ text: m.content }],
        }));

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model.modelId}:generateContent`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": apiKey,
                },
                body: JSON.stringify({
                    contents,
                    generationConfig: {
                        temperature: request.temperature ?? 0.7,
                        maxOutputTokens: request.maxTokens ?? 4096,
                    },
                }),
            }
        );

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Google API error: ${error}`);
        }

        const data = await response.json();

        // Calculate cost (Gemini pricing)
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const estimatedInputTokens = request.messages.reduce((acc, m) => acc + m.content.length / 4, 0);
        const estimatedOutputTokens = content.length / 4;
        const totalTokens = estimatedInputTokens + estimatedOutputTokens;

        const inputCost = (estimatedInputTokens / 1000) * (model.inputCostPer1k || provider.defaultInputCostPer1k || 0.000125);
        const outputCost = (estimatedOutputTokens / 1000) * (model.outputCostPer1k || provider.defaultOutputCostPer1k || 0.000375);
        const totalCost = inputCost + outputCost;

        return {
            content,
            model: model.modelId,
            provider: "google",
            usage: {
                inputTokens: Math.round(estimatedInputTokens),
                outputTokens: Math.round(estimatedOutputTokens),
                totalTokens: Math.round(totalTokens),
                cost: totalCost,
            },
            latency: {
                totalMs: Date.now() - startTime,
            },
            metadata: {
                finishReason: data.candidates?.[0]?.finishReason,
            },
        };
    },
};
