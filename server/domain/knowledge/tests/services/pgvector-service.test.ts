/**
 * PGVector Service Unit Tests
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// Helper to create a chainable mock query
const createMockQuery = (result: any = []) => {
    const query = {
        returning: vi.fn().mockResolvedValue(result),
        then: (onFulfilled: any) => Promise.resolve(result).then(onFulfilled),
    };
    return query;
};

// Mock database
vi.mock("@server/database_service.js", () => {
    return {
        db: {
            execute: vi.fn().mockResolvedValue({ rows: [] }),
            select: vi.fn(() => createMockQuery()),
        },
    };
});

vi.mock("@server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    })),
}));

import { pgvectorService } from "@domain/knowledge/core/indexing/pgvector-service.js";
import { db } from "@server/database_service.js";

describe("PGVectorService", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    describe("Search Operations", () => {
        it("should search for similar nodes", async () => {
            const mockRows = [
                { id: 1, name: "Node 1", similarity: 0.95 },
                { id: 2, name: "Node 2", similarity: 0.85 },
            ];
            (db.execute as Mock).mockResolvedValueOnce({ rows: mockRows });

            const result = await pgvectorService.searchSimilarNodes([0.1, 0.2, 0.3], { limit: 2 });
            expect(result).toHaveLength(2);
            expect(result[0].similarity).toBe(0.95);
            expect(db.execute).toHaveBeenCalled();
        });

        it("should search for similar documents", async () => {
            const mockRows = [
                { id: 1, title: "Doc 1", similarity: 0.88 },
            ];
            (db.execute as Mock).mockResolvedValueOnce({ rows: mockRows });

            const result = await pgvectorService.searchSimilarDocuments([0.1, 0.2], { organizationId: 1 });
            expect(result[0].title).toBe("Doc 1");
            expect(db.execute).toHaveBeenCalled();
        });

        it("should search for similar messages", async () => {
            const mockRows = [
                { id: 1, content: "Hello", similarity: 0.99 },
            ];
            (db.execute as Mock).mockResolvedValueOnce({ rows: mockRows });

            const result = await pgvectorService.searchSimilarMessages([0.5, 0.5], { jobId: 123 });
            expect(result[0].content).toBe("Hello");
            expect(db.execute).toHaveBeenCalled();
        });
    });

    describe("Upsert Operations", () => {
        it("should update node embedding", async () => {
            await pgvectorService.upsertNodeEmbedding(1, [0.1, 0.2]);
            expect(db.execute).toHaveBeenCalled();
        });

        it("should update document embedding", async () => {
            await pgvectorService.upsertDocumentEmbedding(1, [0.1, 0.2]);
            expect(db.execute).toHaveBeenCalled();
        });

        it("should update message embedding", async () => {
            await pgvectorService.upsertMessageEmbedding(1, [0.1, 0.2]);
            expect(db.execute).toHaveBeenCalled();
        });

        it("should batch update embeddings", async () => {
            const items = [
                { id: 1, embedding: [0.1], table: 'nodes' as const },
                { id: 2, embedding: [0.2], table: 'documents' as const },
            ];

            await pgvectorService.batchUpsertEmbeddings(items);
            expect(db.execute).toHaveBeenCalledTimes(2);
        });
    });

    describe("Stats", () => {
        it("should return embedding statistics", async () => {
            (db.execute as Mock)
                .mockResolvedValueOnce({ rows: [{ total: 10, with_embeddings: 5 }] }) // nodes
                .mockResolvedValueOnce({ rows: [{ total: 20, with_embeddings: 10 }] }) // docs
                .mockResolvedValueOnce({ rows: [{ total: 30, with_embeddings: 15 }] }); // messages

            const stats = await pgvectorService.getEmbeddingStats();
            expect(stats.nodes.total).toBe(10);
            expect(stats.documents.withEmbeddings).toBe(10);
            expect(stats.messages.total).toBe(30);
        });
    });
});
