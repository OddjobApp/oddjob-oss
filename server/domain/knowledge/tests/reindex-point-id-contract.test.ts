import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `qdrant_point_id` is a claim that a document is retrievable. It has to be
 * earned.
 *
 * The outage this pins: an embedding provider over its spending cap resolved an
 * EMPTY vector instead of throwing, chunking produced nothing, and reindex
 * logged "Re-indexed" and resolved successfully — so the caller's catch never
 * ran and the row kept a point id for a point that never existed. Completed
 * research briefings were silently unfindable, and nothing anywhere recorded
 * the gap.
 */

const assetToDocuments = vi.fn();
const addDocumentsToVectorStore = vi.fn();
const deleteAssetFromVectorStore = vi.fn();

vi.mock("@domain/knowledge/core/rag-langchain.service.js", async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, assetToDocuments, addDocumentsToVectorStore, deleteAssetFromVectorStore };
});

const { reindexKnowledgeDocument } = await import("../core/knowledge-store.js");

const doc = (over: Record<string, unknown> = {}) => ({
    id: 42,
    title: "Research Briefing",
    textContent: "A briefing with real content that must be embedded.",
    organizationId: 291,
    projectId: 2,
    qdrantPointId: "point-abc",
    ...over,
});

beforeEach(() => {
    assetToDocuments.mockReset();
    addDocumentsToVectorStore.mockReset();
    deleteAssetFromVectorStore.mockReset();
});

describe("reindexKnowledgeDocument", () => {
    it("reports what actually reached the store", async () => {
        assetToDocuments.mockResolvedValue([{ pageContent: "a" }, { pageContent: "b" }]);

        const result = await reindexKnowledgeDocument(doc());

        expect(result).toEqual({ indexed: true, chunks: 2 });
        expect(addDocumentsToVectorStore).toHaveBeenCalledTimes(1);
    });

    it("throws when a document with content embeds to nothing", async () => {
        // The exact silent-death shape: content present, zero chunks out.
        assetToDocuments.mockResolvedValue([]);

        await expect(reindexKnowledgeDocument(doc())).rejects.toThrow(/0 chunks/i);
    });

    it("does not destroy existing vectors when embedding fails", async () => {
        assetToDocuments.mockResolvedValue([]);

        await expect(reindexKnowledgeDocument(doc())).rejects.toThrow();

        // Deleting here would turn a stale document into an unfindable one.
        expect(deleteAssetFromVectorStore).not.toHaveBeenCalled();
        expect(addDocumentsToVectorStore).not.toHaveBeenCalled();
    });

    it("reports a genuinely empty document as not indexed, without throwing", async () => {
        assetToDocuments.mockResolvedValue([]);

        const result = await reindexKnowledgeDocument(doc({ textContent: "   " }));

        // An image or empty stub has nothing to embed. That is not a failure —
        // but it is emphatically not "indexed" either.
        expect(result).toEqual({ indexed: false, chunks: 0, reason: "no_content" });
        expect(deleteAssetFromVectorStore).toHaveBeenCalledTimes(1);
        expect(addDocumentsToVectorStore).not.toHaveBeenCalled();
    });

    it("treats a null textContent as nothing to embed rather than a failure", async () => {
        assetToDocuments.mockResolvedValue([]);

        const result = await reindexKnowledgeDocument(doc({ textContent: null }));

        expect(result.indexed).toBe(false);
    });

    it("propagates a real store failure rather than reporting success", async () => {
        assetToDocuments.mockResolvedValue([{ pageContent: "a" }]);
        addDocumentsToVectorStore.mockRejectedValue(new Error("Qdrant unreachable"));

        await expect(reindexKnowledgeDocument(doc())).rejects.toThrow(/Qdrant unreachable/);
    });
});
