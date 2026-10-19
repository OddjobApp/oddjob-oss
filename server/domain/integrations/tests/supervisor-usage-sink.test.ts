/**
 * The supervisor is the only job type that has ever executed in this deployment, and
 * its LLM calls were invisible to ai_usage_logs — they were recorded only as
 * integration telemetry. plan() and triage() now report each call to a usage sink so
 * the executor can hand it to AIAnalyticsHook along with the step execution id.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();

vi.mock("@domain/ai/core/ai-client.service.js", () => ({
    AIClientFactory: { getClient: () => ({ execute }) },
}));
vi.mock("../core/mcp-client.service.js", () => ({
    mcpClientService: { getAllTools: async () => [] },
}));
vi.mock("../../ai/core/system-ai.service.js", () => ({
    systemAiService: {
        getAiConfig: async () => ({ provider: "google", model: "gemini-2.5-flash", apiKey: "k", baseUrl: null }),
    },
}));

import { supervisorService, type AiCallUsage } from "../core/supervisor.service.js";

const planJson = JSON.stringify({ intent: "do a thing", tasks: [] });

const aiResponse = (output: string, promptTokens: number, completionTokens: number) => ({
    success: true,
    output,
    metadata: { provider: "google", model: "gemini-2.5-flash", promptTokens, completionTokens },
});

describe("supervisorService usage reporting", () => {
    beforeEach(() => execute.mockReset());

    it("reports the planning call's real token counts to the sink", async () => {
        execute.mockResolvedValue(aiResponse(planJson, 1200, 300));
        const usage: AiCallUsage[] = [];

        await supervisorService.plan(
            "do a thing", "gemini-2.5-flash", undefined, "", "", undefined, "", 1, undefined, undefined,
            (u) => usage.push(u),
        );

        expect(usage).toEqual([
            { provider: "google", model: "gemini-2.5-flash", promptTokens: 1200, completionTokens: 300 },
        ]);
    });

    it("bills a retried plan for every attempt, not just the one that validated", async () => {
        execute
            .mockResolvedValueOnce(aiResponse("not json at all", 500, 50))
            .mockResolvedValueOnce(aiResponse(planJson, 700, 90));
        const usage: AiCallUsage[] = [];

        await supervisorService.plan(
            "do a thing", "gemini-2.5-flash", undefined, "", "", undefined, "", 1, undefined, undefined,
            (u) => usage.push(u),
        );

        expect(usage.map((u) => u.promptTokens)).toEqual([500, 700]);
    });

    it("reports the triage call too", async () => {
        execute.mockResolvedValue(aiResponse(JSON.stringify({ recommendation: "r", action: "retry" }), 80, 12));
        const usage: AiCallUsage[] = [];

        await supervisorService.triage("intent", "history", 1, undefined, (u) => usage.push(u));

        expect(usage).toEqual([
            { provider: "google", model: "gemini-2.5-flash", promptTokens: 80, completionTokens: 12 },
        ]);
    });

    it("records nothing when the provider returned no token counts", async () => {
        execute.mockResolvedValue({ success: true, output: planJson, metadata: { provider: "google", model: "gemini-2.5-flash" } });
        const usage: AiCallUsage[] = [];

        await supervisorService.plan(
            "do a thing", "gemini-2.5-flash", undefined, "", "", undefined, "", 1, undefined, undefined,
            (u) => usage.push(u),
        );

        expect(usage).toEqual([]);
    });

    it("still works for callers that pass no sink", async () => {
        execute.mockResolvedValue(aiResponse(planJson, 10, 2));
        await expect(
            supervisorService.plan("do a thing", "gemini-2.5-flash", undefined, "", "", undefined, "", 1),
        ).resolves.toMatchObject({ intent: "do a thing" });
    });
});
