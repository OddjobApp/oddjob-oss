/**
 * Mock LLM Adapter
 * Provides deterministic, offline, fixture-driven LLM completions and streaming
 * for unit tests, CI pipelines, and reproducible E2E suites.
 */

import { createLogger } from "@server/utils/logger.js";
import type { LLMRequest, LLMResponse, LLMAdapter } from "./types.js";

const logger = createLogger("MockLLMAdapter");

export interface MockFixtureRule {
    pattern: RegExp | string;
    response: string | ((req: LLMRequest) => string);
}

class MockLLMRegistry {
    private rules: MockFixtureRule[] = [];
    private defaultHandler: (req: LLMRequest) => string = (req) => {
        const lastMsg = req.messages[req.messages.length - 1]?.content || "";
        return `[MOCK_LLM_RESPONSE]: Processed request for input of length ${lastMsg.length}`;
    };

    registerRule(rule: MockFixtureRule) {
        this.rules.unshift(rule);
    }

    clearRules() {
        this.rules = [];
    }

    match(req: LLMRequest): string {
        const lastMessage = req.messages[req.messages.length - 1]?.content || "";
        for (const rule of this.rules) {
            const matches = typeof rule.pattern === "string" 
                ? lastMessage.includes(rule.pattern)
                : rule.pattern.test(lastMessage);

            if (matches) {
                return typeof rule.response === "function" ? rule.response(req) : rule.response;
            }
        }
        return this.defaultHandler(req);
    }
}

export const mockLLMRegistry = new MockLLMRegistry();

// Default preset fixtures for common Oddjob domain tasks
mockLLMRegistry.registerRule({
    pattern: /triage|dispatch|anomaly/i,
    response: JSON.stringify({
        status: "TRIAGED",
        severity: "HIGH",
        recommendedAction: "DEPLOY_SQUAD",
        confidence: 0.98,
        summary: "Commercial generator overheating incident verified with critical thermal gradient."
    })
});

mockLLMRegistry.registerRule({
    pattern: /geocod|address|serial/i,
    response: JSON.stringify({
        resolvedAddress: "200 N Spring St, Los Angeles, CA",
        assetSerial: "GEN-8842-X",
        verified: true,
        riskScore: 12
    })
});

export const mockLLMAdapter: LLMAdapter = {
    name: "mock",

    async complete(request: LLMRequest, model: any = {}, provider: any = {}): Promise<LLMResponse> {
        const startTime = Date.now();
        const content = mockLLMRegistry.match(request);
        const inputTokens = request.messages.reduce((acc, m) => acc + Math.ceil(m.content.length / 4), 0);
        const outputTokens = Math.ceil(content.length / 4);

        return {
            content,
            model: model?.modelId || "mock-model-deterministic",
            provider: "mock",
            usage: {
                inputTokens,
                outputTokens,
                totalTokens: inputTokens + outputTokens,
                cost: 0.0,
            },
            latency: {
                totalMs: Date.now() - startTime,
            },
            metadata: {
                isMock: true,
                finishReason: "stop",
            },
        };
    },

    async stream(
        request: LLMRequest,
        model: any = {},
        provider: any = {},
        onChunk: (chunk: string) => void
    ): Promise<LLMResponse> {
        const fullResponse = await this.complete(request, model, provider);
        const chunks = fullResponse.content.match(/.{1,16}/g) || [fullResponse.content];

        for (const chunk of chunks) {
            onChunk(chunk);
        }

        return fullResponse;
    }
};
