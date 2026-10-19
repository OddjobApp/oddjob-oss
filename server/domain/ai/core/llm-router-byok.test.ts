import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), getClient: vi.fn(), execute: vi.fn(), insert: vi.fn() }));
vi.mock("@server/database_service.js", () => ({
    db: { insert: () => ({ values: async (row: unknown) => { mocks.insert(row); } }) },
}));
vi.mock("./org-model.service.js", () => ({ orgModelService: { resolve: mocks.resolve } }));
vi.mock("./ai-client.service.js", () => ({ AIClientFactory: { getClient: mocks.getClient } }));

import { llmRouterService } from "./llm-router.service.js";

describe("LLM router on an organization's own keys", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getClient.mockReturnValue({ execute: mocks.execute });
        mocks.execute.mockResolvedValue({ success: true, output: "answer", metadata: { promptTokens: 4, completionTokens: 2 } });
    });
    afterEach(() => vi.unstubAllEnvs());

    it("runs on the org's default connection even when the request prefers another provider", async () => {
        mocks.resolve.mockResolvedValue({ provider: "anthropic", apiKey: "ant-key", model: "claude-sonnet-5-5", credentialId: 0 });
        const response = await llmRouterService.complete({
            messages: [{ role: "user", content: "hi" }], preferredProvider: "openai",
        } as any, 7);
        expect(mocks.resolve).toHaveBeenCalledWith(7);
        expect(mocks.getClient).toHaveBeenCalledWith({ provider: "anthropic" });
        expect(mocks.execute.mock.calls[0][0]).toMatchObject({ organizationId: 7, model: "claude-sonnet-5-5" });
        expect(response).toMatchObject({ content: "answer", provider: "anthropic", model: "claude-sonnet-5-5" });
        expect(mocks.insert.mock.calls[0][0]).toMatchObject({ routingStrategy: "direct_anthropic", organizationId: 7 });
    });

    it("refuses in production when the org has connected no provider", async () => {
        vi.stubEnv("NODE_ENV", "production");
        mocks.resolve.mockResolvedValue(null);
        await expect(llmRouterService.complete({ messages: [{ role: "user", content: "hi" }] } as any, 7))
            .rejects.toThrow("Connect your organization's AI provider key");
        expect(mocks.execute).not.toHaveBeenCalled();
    });
});
