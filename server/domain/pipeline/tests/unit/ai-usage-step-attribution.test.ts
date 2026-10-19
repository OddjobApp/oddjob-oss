/**
 * ai_usage_logs.step_execution_id was NULL for every row in the database.
 *
 * The plumbing that carries the id was intact end to end; what was missing was a
 * producer. Only `supervisor` jobs have ever executed here, and the supervisor made
 * its planning/triage LLM calls without ever declaring them as step AI usage, so
 * AIAnalyticsHook — the one place that knows the step execution id — had nothing to
 * write. These tests pin the two links that were rebuilt.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const logAIUsage = vi.fn().mockResolvedValue(undefined);
vi.mock("@domain/admin/core/analytics.service.js", () => ({ logAIUsage }));

import { AIAnalyticsHook } from "../../hooks/analytics-hooks.js";
import { attachAiUsage } from "../../../jobs/core/executors/supervisor-job-executor.js";

const params = (result: any) => ({
    result,
    currentStep: { id: 9 },
    pipeline: { id: 42 },
    pipelineExecution: { id: 77 },
    stepExecution: { id: 1234 },
    orgId: 3,
    userId: "user-a",
}) as any;

describe("attachAiUsage", () => {
    it("does not mark a step as AI usage when no LLM call was made", () => {
        const result = attachAiUsage({ success: true } as any, []);
        expect("__aiUsageMetadata" in (result as any)).toBe(false);
    });

    it("sums tokens per provider+model instead of pooling them under one price", () => {
        const result: any = attachAiUsage({ success: true } as any, [
            { provider: "google", model: "gemini-2.5-flash", promptTokens: 100, completionTokens: 20 },
            { provider: "google", model: "gemini-2.5-flash", promptTokens: 50, completionTokens: 5 },
            { provider: "google", model: "gemini-2.5-pro", promptTokens: 900, completionTokens: 300 },
        ]);

        expect(result.__aiUsageMetadata).toEqual([
            { provider: "google", model: "gemini-2.5-flash", promptTokens: 150, completionTokens: 25 },
            { provider: "google", model: "gemini-2.5-pro", promptTokens: 900, completionTokens: 300 },
        ]);
    });
});

describe("AIAnalyticsHook.onStepComplete", () => {
    beforeEach(() => logAIUsage.mockClear());

    it("stamps the step execution id on the usage row", async () => {
        await new AIAnalyticsHook().onStepComplete(params({
            __aiUsageMetadata: { provider: "google", model: "gemini-2.5-flash", promptTokens: 10, completionTokens: 2 },
        }));

        expect(logAIUsage).toHaveBeenCalledTimes(1);
        expect(logAIUsage.mock.calls[0][0]).toMatchObject({
            stepExecutionId: 1234,
            executionId: 77,
            pipelineId: 42,
            organizationId: 3,
        });
    });

    it("forwards explicit token counts, which is what keeps Gemini rows from costing $0", async () => {
        await new AIAnalyticsHook().onStepComplete(params({
            __aiUsageMetadata: { provider: "google", model: "gemini-2.5-flash", promptTokens: 1500, completionTokens: 400 },
        }));

        expect(logAIUsage.mock.calls[0][0]).toMatchObject({ promptTokens: 1500, completionTokens: 400 });
    });

    it("writes one row per model when a step used several", async () => {
        await new AIAnalyticsHook().onStepComplete(params({
            __aiUsageMetadata: [
                { provider: "google", model: "gemini-2.5-flash", promptTokens: 10, completionTokens: 1 },
                { provider: "google", model: "gemini-2.5-pro", promptTokens: 20, completionTokens: 2 },
            ],
        }));

        expect(logAIUsage).toHaveBeenCalledTimes(2);
        expect(logAIUsage.mock.calls.map((c: any[]) => c[0].model)).toEqual(["gemini-2.5-flash", "gemini-2.5-pro"]);
        expect(logAIUsage.mock.calls.every((c: any[]) => c[0].stepExecutionId === 1234)).toBe(true);
    });

    it("stays silent for a step that made no LLM call", async () => {
        await new AIAnalyticsHook().onStepComplete(params({ success: true }));
        expect(logAIUsage).not.toHaveBeenCalled();
    });
});
