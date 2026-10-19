/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const inserted: any[] = [];
const updated: any[] = [];
vi.mock("@server/database_service.js", () => ({
    db: {
        insert: () => ({ values: (v: unknown) => { inserted.push(v); return Promise.resolve(); } }),
        update: () => ({ set: (v: unknown) => ({ where: () => { updated.push(v); return Promise.resolve(); } }) }),
    },
}));

import { llmRouterService } from "./llm-router.service.js";

const selection = { provider: { id: 1, name: "google" }, model: { id: 2, modelId: "gemini-flash-latest" }, strategy: "cost" };
const request = { messages: [{ role: "user", content: "hi" }], organizationId: 291 } as any;

describe("llm_router_logs attribution", () => {
    beforeEach(() => { inserted.length = 0; updated.length = 0; });

    // The regression: organization_id was never written, so every row was
    // unattributed and the crew budget guard - which sums this table per org -
    // measured zero spend for every tenant and could never stop a room.
    it("records the organization a routed call belongs to", async () => {
        await llmRouterService.logRoutingDecision("req-1", selection, request, undefined, undefined, 291);
        expect(inserted[0]).toMatchObject({ requestId: "req-1", organizationId: 291 });
    });

    it("falls back to the org carried on the request", async () => {
        await llmRouterService.logRoutingDecision("req-2", selection, request);
        expect(inserted[0]).toMatchObject({ organizationId: 291 });
    });

    it("attributes a fallback attempt too", async () => {
        await llmRouterService.logFallbackSuccess(
            "req-3", 1, selection.provider, selection.model,
            { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cost: 0 } } as any, 10, 291,
        );
        expect(inserted[0]).toMatchObject({ wasFallback: true, organizationId: 291 });
    });

    // The regression: withResilience() answers a quota-exhausted cloud call from
    // local Ollama and marks metadata.fallback, but logSuccess recorded the row
    // as a plain success on the *selected* model — a gemini-priced "success"
    // that was really qwen2.5.
    it("marks a client-served fallback instead of crediting the selected model", async () => {
        const response = {
            usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10, cost: 0 },
            latency: {},
            metadata: { provider: "ollama", model: "qwen2.5:7b", fallback: "ollama" },
        } as any;
        await llmRouterService.logSuccess("req-4", selection, response, 12);
        expect(updated[0]).toMatchObject({ success: true, wasFallback: true });
        // servedBy is merged into request_params via a sql`` fragment — assert
        // the fragment exists rather than matching drizzle internals.
        expect(updated[0].requestParams).toBeDefined();
    });

    it("leaves wasFallback untouched when the serving model matches", async () => {
        const response = {
            usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10, cost: 0 },
            latency: {},
            metadata: { provider: "google", model: "gemini-flash-latest" },
        } as any;
        await llmRouterService.logSuccess("req-5", selection, response, 12);
        expect(updated[0]).toMatchObject({ success: true });
        expect(updated[0].wasFallback).toBeUndefined();
        expect(updated[0].requestParams).toBeUndefined();
    });
});
