import { describe, it, expect, vi, beforeEach } from "vitest";

const qdrant = vi.hoisted(() => ({
    ensureQdrantCollection: vi.fn(async () => undefined),
    upsertQdrantPoints: vi.fn(async () => undefined),
    searchQdrant: vi.fn(async () => []),
    deleteQdrantByFilter: vi.fn(async () => undefined),
}));

vi.mock("../../../integrations/qdrant-client.js", () => ({ ...qdrant, QDRANT_COLLECTION: "oddjob_rag_assets" }));

const platform = vi.hoisted(() => ({ retrievePlatformDocumentation: vi.fn(() => [] as any[]) }));
vi.mock("./platform-documentation-retrieval.js", () => platform);

import { addDocumentsToVectorStore, requireVectorOrgId, retrieveSimilarDocuments } from "./rag-langchain.service.js";

/**
 * A missing organization used to select the shared default collection, which
 * holds chunks of several real organizations, and read it with no org filter.
 * These pin that neither a read nor a write reaches Qdrant without one.
 */
describe("vector store organization guard", () => {
    beforeEach(() => vi.clearAllMocks());

    it("accepts a positive integer organization and nothing else", () => {
        expect(requireVectorOrgId(7, "retrieval")).toBe(7);
        for (const missing of [null, undefined, 0, -1, Number.NaN, 1.5]) {
            expect(() => requireVectorOrgId(missing as any, "retrieval")).toThrow(/Organization context required/);
        }
    });

    it("refuses retrieval with no organization before embedding or searching", async () => {
        await expect(retrieveSimilarDocuments("anything", {})).rejects.toThrow(/Organization context required for vector retrieval/);
        await expect(retrieveSimilarDocuments("anything", { organizationId: null })).rejects.toThrow(/Organization context required/);
        expect(qdrant.searchQdrant).not.toHaveBeenCalled();
    });

    it("still returns the organization's documents when the platform library cannot load", async () => {
        process.env.SKIP_GEMINI_EMBEDDINGS = "true";
        platform.retrievePlatformDocumentation.mockImplementationOnce(() => { throw new Error("ENOENT: docs/CYCLES.md"); });
        qdrant.searchQdrant.mockResolvedValueOnce([{ id: "p1", score: 0.9, payload: { pageContent: "org body", assetId: 5, name: "Org doc", organizationId: 7 } }] as any);
        const docs = await retrieveSimilarDocuments("anything", { organizationId: 7 });
        expect(docs.map((d) => d.pageContent)).toEqual(["org body"]);
        delete process.env.SKIP_GEMINI_EMBEDDINGS;
    });

    it("refuses to index a chunk that has no organization", async () => {
        const doc = { pageContent: "orphan", metadata: { organizationId: null, assetId: 1, chunkId: "c" } } as any;
        await expect(addDocumentsToVectorStore([doc])).rejects.toThrow(/Organization context required for vector indexing/);
        expect(qdrant.ensureQdrantCollection).not.toHaveBeenCalled();
        expect(qdrant.upsertQdrantPoints).not.toHaveBeenCalled();
    });
});
