/**
 * Azure OpenAI Adapter
 * Handles completions for Azure-hosted OpenAI models
 */

import { createLogger } from "@server/utils/logger.js";
import type { LLMRequest, LLMResponse, LLMAdapter } from "./types.js";

const logger = createLogger("AzureAdapter");

export const azureAdapter: LLMAdapter = {
    name: "azure",

    async complete(request: LLMRequest, model: any, provider: any): Promise<LLMResponse> {
        const startTime = Date.now();
        const apiKey = provider.apiKey || process.env.AZURE_OPENAI_API_KEY;
        const endpoint = provider.apiEndpoint || process.env.AZURE_OPENAI_ENDPOINT;

        if (!apiKey || !endpoint) {
            throw new Error("Azure OpenAI credentials not configured");
        }

        const deploymentName = model.modelId.replace(/\./g, ""); // Azure uses deployment names without dots

        const response = await fetch(
            `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-02-01`,
            {
                method: "POST",
                headers: {
                    "api-key": apiKey,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    messages: request.messages,
                    temperature: request.temperature ?? 0.7,
                    max_tokens: request.maxTokens ?? 4096,
                }),
            }
        );

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Azure OpenAI API error: ${error}`);
        }

        const data = await response.json();

        // Calculate cost
        const inputTokens = data.usage?.prompt_tokens || 0;
        const outputTokens = data.usage?.completion_tokens || 0;
        const totalTokens = data.usage?.total_tokens || 0;

        const inputCost = (inputTokens / 1000) * (model.inputCostPer1k || provider.defaultInputCostPer1k || 0.01);
        const outputCost = (outputTokens / 1000) * (model.outputCostPer1k || provider.defaultOutputCostPer1k || 0.03);
        const totalCost = inputCost + outputCost;

        return {
            content: data.choices[0]?.message?.content || "",
            model: model.modelId,
            provider: "azure",
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
};
