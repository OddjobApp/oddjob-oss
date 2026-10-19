/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

// attemptFallback only reads the provider list and rethrows; the module pulls in
// the database and every provider adapter at import time.
const { selectResults } = vi.hoisted(() => ({ selectResults: [] as any[][] }));
vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => ({ limit: async () => selectResults.shift() ?? [] }),
            }),
        }),
        insert: () => ({ values: async () => undefined }),
        update: () => ({ set: () => ({ where: async () => undefined }) }),
    },
}));

import { llmRouterService } from "./llm-router.service.js";

/**
 * Every org in this deployment has exactly one llm_providers row, so
 * `providers[1]` is always undefined and every routed failure reached this
 * branch. It used to answer with "No fallback providers available", which threw
 * the real cause away: a CREW round whose speakers all failed because the org
 * had no Gemini key connected reported a routing problem instead, and the room
 * showed nothing at all.
 */
describe("attemptFallback with nothing to fall back to", () => {
    const singleProvider = [{ id: 1, name: "google" }];

    it("rethrows the error that actually failed", async () => {
        const spy = vi.spyOn(llmRouterService, "getActiveProviders").mockResolvedValue(singleProvider as never);
        const cause = new Error("Connect your organization's Gemini API key in Organization Settings before running AI work");

        await expect(
            llmRouterService.attemptFallback({ messages: [] } as never, "req-1", 342, undefined, undefined, cause, 1),
        ).rejects.toThrow(cause.message);

        spy.mockRestore();
    });

    it("keeps the same error identity, so a caller can still match on it", async () => {
        const spy = vi.spyOn(llmRouterService, "getActiveProviders").mockResolvedValue(singleProvider as never);
        const cause = new Error("429 quota exceeded");

        await expect(
            llmRouterService.attemptFallback({ messages: [] } as never, "req-2", 342, undefined, undefined, cause, 1),
        ).rejects.toBe(cause);

        spy.mockRestore();
    });

    it("still names the missing fallback when nothing failed before it", async () => {
        const spy = vi.spyOn(llmRouterService, "getActiveProviders").mockResolvedValue(singleProvider as never);

        await expect(
            llmRouterService.attemptFallback({ messages: [] } as never, "req-3", 342, undefined, undefined, undefined, 1),
        ).rejects.toThrow("No fallback providers available");

        spy.mockRestore();
    });
});

describe("attemptFallback model selection", () => {
    it("uses the provider's non-default active model when none is marked default", async () => {
        // Regression: `fallbackModel[0] || fallbackModel` resolved to the empty
        // array when the fallback provider had no isDefault row — anyModel was
        // fetched and discarded — so the adapter received [] and unifiedComplete
        // reported "<provider> provider not found" instead of the real failure.
        const spy = vi.spyOn(llmRouterService, "getActiveProviders").mockResolvedValue([
            { id: 6, name: "anthropic" },
            { id: 2, name: "google" },
        ] as never);

        selectResults.length = 0;
        selectResults.push(
            [], // no isDefault model for provider 2
            [{ id: 2, providerId: 2, modelId: "gemini-flash-latest" }], // anyModel
            [], // updateProviderHealth lookup
        );

        const complete = vi.fn(async () => ({
            content: "ok",
            model: "gemini-flash-latest",
            provider: "google",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 },
        }));
        llmRouterService.registerAdapter("google", { name: "google", complete } as never);

        const response = await llmRouterService.attemptFallback(
            { messages: [] } as never,
            "req-9",
            291,
            undefined,
            undefined,
            new Error("Anthropic API error (400): credit balance too low"),
            1,
        );

        expect(complete).toHaveBeenCalledWith(
            { messages: [] },
            expect.objectContaining({ modelId: "gemini-flash-latest" }),
        );
        expect(response.content).toBe("ok");

        spy.mockRestore();
    });
});
