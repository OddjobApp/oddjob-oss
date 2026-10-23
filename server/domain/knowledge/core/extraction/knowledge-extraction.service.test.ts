import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ selects: [] as unknown[][], execute: vi.fn(), update: vi.fn() }));
vi.mock("@server/database_service.js", () => ({ db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.selects.shift() ?? [] }) }) }),
    update: () => ({ set: (values: unknown) => ({ where: async () => { mocks.update(values); } }) }),
} }));
vi.mock("@domain/knowledge/core/rag-utils.service.js", () => ({ getAssetPlainText: async () =>
    Array.from({ length: 120 }, (_, i) => `Line ${i}: ticket JIRA-${i} reported by user${i}@example.com`).join("\n") }));
vi.mock("@domain/knowledge/core/knowledge-store.js", () => ({ mapKnowledgeDocumentToRagSource: (doc: unknown) => doc }));
vi.mock("@domain/ai/core/ai-client.service.js", () => ({ AIClientFactory: { getClient: () => ({ execute: mocks.execute }) } }));
vi.mock("@domain/ai/core/organization-ai-client.js", () => ({
    ORG_AI_KEY_MISSING: "Connect your organization's AI provider key in Organization Settings before running AI work",
}));
import { KnowledgeExtractionService } from "./knowledge-extraction.service.js";
import { ORG_AI_KEY_MISSING } from "@domain/ai/core/organization-ai-client.js";

describe("knowledge extraction on the organization's AI connection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.selects = [[{ id: 3, contentType: "text/plain" }], [{ id: 5, mappings: [] }]];
    });

    it("names the organization on every call, so its own connection (Gemini, Bedrock, ...) runs it", async () => {
        mocks.execute.mockResolvedValue({ success: true, output: '{"nodes":[],"edges":[]}' });
        await new KnowledgeExtractionService().processExtractionTask(11, 3, 5, 7);
        // 120 lines in 50-line chunks.
        expect(mocks.execute).toHaveBeenCalledTimes(3);
        expect(mocks.execute.mock.calls.every(call => call[0].organizationId === 7)).toBe(true);
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    });

    it("fails the extraction at the first chunk when the organization has no AI connection", async () => {
        mocks.execute.mockRejectedValue(new Error(ORG_AI_KEY_MISSING));
        await expect(new KnowledgeExtractionService().processExtractionTask(11, 3, 5, 7)).rejects.toThrow(ORG_AI_KEY_MISSING);
        expect(mocks.execute).toHaveBeenCalledOnce();
        expect(mocks.update).not.toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    });

    it("still skips a chunk the model answers badly and carries on", async () => {
        mocks.execute.mockResolvedValueOnce({ success: false, error: "throttled" })
            .mockResolvedValue({ success: true, output: '{"nodes":[],"edges":[]}' });
        await new KnowledgeExtractionService().processExtractionTask(11, 3, 5, 7);
        expect(mocks.execute).toHaveBeenCalledTimes(3);
        expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
    });
});
