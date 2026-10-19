import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Drizzle chain mock. Every builder method returns the chain; the chain is
// thenable and resolves to the next queued result, so each `await db.…()`
// consumes one entry from `dbResults`.
// ---------------------------------------------------------------------------
let dbResults: any[][] = [];

function makeChain() {
    const chain: any = {
        from: () => chain,
        where: () => chain,
        limit: () => chain,
        orderBy: () => chain,
        set: () => chain,
        values: () => chain,
        returning: () => chain,
        then: (resolve: any, reject: any) =>
            Promise.resolve(dbResults.shift() ?? []).then(resolve, reject),
    };
    return chain;
}

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => makeChain(),
        insert: () => makeChain(),
        update: () => makeChain(),
    },
}));

const generateEmbedding = vi.fn();
vi.mock("@domain/knowledge/core/rag/embedding-service.js", () => ({
    embeddingService: {
        generateEmbedding: (text: string) => generateEmbedding(text),
    },
}));

const searchQdrant = vi.fn();
const upsertQdrantPoints = vi.fn();
const deleteQdrantPoints = vi.fn();
vi.mock("@server/integrations/qdrant-client.js", () => ({
    searchQdrant: (...args: any[]) => searchQdrant(...args),
    upsertQdrantPoints: (...args: any[]) => upsertQdrantPoints(...args),
    deleteQdrantPoints: (...args: any[]) => deleteQdrantPoints(...args),
}));

import { longTermMemoryService } from "./long-term-memory.service.js";

const VECTOR = new Array(768).fill(0.1);

function row(id: number, content: string) {
    return { id, organizationId: 1, userId: null, type: "fact", key: null, content, importance: 5 };
}

describe("longTermMemoryService", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbResults = [];
        generateEmbedding.mockResolvedValue(VECTOR);
        searchQdrant.mockResolvedValue([]);
        upsertQdrantPoints.mockResolvedValue(undefined);
    });

    describe("recall — vector path", () => {
        it("returns hits in Qdrant's ranking, not the database's id order", async () => {
            searchQdrant.mockResolvedValue([{ id: 3, score: 0.9 }, { id: 1, score: 0.7 }]);
            // Postgres hands rows back in whatever order it likes.
            dbResults.push([row(1, "older but lower ranked"), row(3, "best match")]);

            const results = await longTermMemoryService.recall({
                organizationId: 1,
                search: "deployment region",
            });

            expect(results.map((r: any) => r.id)).toEqual([3, 1]);
        });

        it("drops hits that the org-filtered hydrate does not return", async () => {
            // Point 99 belongs to another org — its payload said otherwise, or it
            // is stale. Postgres is the authority, so it must not surface.
            searchQdrant.mockResolvedValue([{ id: 1, score: 0.9 }, { id: 99, score: 0.8 }]);
            dbResults.push([row(1, "mine")]);

            const results = await longTermMemoryService.recall({
                organizationId: 1,
                search: "anything",
            });

            expect(results.map((r: any) => r.id)).toEqual([1]);
        });

        it("scopes the vector search to the organization", async () => {
            searchQdrant.mockResolvedValue([{ id: 1, score: 0.9 }]);
            dbResults.push([row(1, "mine")]);

            await longTermMemoryService.recall({ organizationId: 42, search: "x" });

            const filter = searchQdrant.mock.calls[0][1].filter;
            expect(filter.must).toContainEqual({
                key: "organizationId",
                match: { value: 42 },
            });
        });
    });

    describe("recall — fallback to substring scan", () => {
        it("falls back when the embedding provider returns null", async () => {
            generateEmbedding.mockResolvedValue(null);
            dbResults.push([row(1, "found by ilike")]);

            const results = await longTermMemoryService.recall({
                organizationId: 1,
                search: "term",
            });

            expect(searchQdrant).not.toHaveBeenCalled();
            expect(results.map((r: any) => r.id)).toEqual([1]);
        });

        it("falls back when the provider returns an EMPTY vector", async () => {
            // The capped-Gemini shape: HTTP 200, zero-length vector, no error.
            // Treating this as a successful embedding is how recall goes dark.
            generateEmbedding.mockResolvedValue([]);
            dbResults.push([row(1, "found by ilike")]);

            const results = await longTermMemoryService.recall({
                organizationId: 1,
                search: "term",
            });

            expect(searchQdrant).not.toHaveBeenCalled();
            expect(results.map((r: any) => r.id)).toEqual([1]);
        });

        it("falls back when the index has no points yet", async () => {
            // Rows written before the vector path existed: Qdrant knows nothing
            // about them, and returning [] here would be a silent regression.
            searchQdrant.mockResolvedValue([]);
            dbResults.push([row(7, "pre-index row")]);

            const results = await longTermMemoryService.recall({
                organizationId: 1,
                search: "term",
            });

            expect(results.map((r: any) => r.id)).toEqual([7]);
        });

        it("falls back when the vector search throws", async () => {
            searchQdrant.mockRejectedValue(new Error("qdrant down"));
            dbResults.push([row(7, "still reachable")]);

            const results = await longTermMemoryService.recall({
                organizationId: 1,
                search: "term",
            });

            expect(results.map((r: any) => r.id)).toEqual([7]);
        });

        it("never embeds when there is no search term", async () => {
            dbResults.push([row(1, "listing")]);

            await longTermMemoryService.recall({ organizationId: 1 });

            expect(generateEmbedding).not.toHaveBeenCalled();
            expect(searchQdrant).not.toHaveBeenCalled();
        });
    });

    describe("remember", () => {
        it("indexes the new row under its own row id", async () => {
            dbResults.push([{ id: 55 }]); // insert().returning()

            const id = await longTermMemoryService.remember({
                organizationId: 1,
                type: "fact",
                content: "prod Postgres listens on 5433",
            });

            expect(id).toBe(55);
            expect(upsertQdrantPoints).toHaveBeenCalledTimes(1);
            const [points, collection] = upsertQdrantPoints.mock.calls[0];
            expect(points[0].id).toBe(55);
            expect(points[0].payload).toMatchObject({ memoryId: 55, organizationId: 1, type: "fact" });
            expect(collection).toBe("agent_long_term_memory");
        });

        it("keeps the row when indexing fails", async () => {
            // The write is committed before indexing is attempted. An embedding
            // outage must cost searchability, never the memory itself.
            generateEmbedding.mockResolvedValue(null);
            dbResults.push([{ id: 56 }]);

            const id = await longTermMemoryService.remember({
                organizationId: 1,
                type: "fact",
                content: "still stored",
            });

            expect(id).toBe(56);
            expect(upsertQdrantPoints).not.toHaveBeenCalled();
        });
    });

    describe("index", () => {
        it("refuses to write an empty vector", async () => {
            generateEmbedding.mockResolvedValue([]);

            const ok = await longTermMemoryService.index(1, {
                organizationId: 1,
                type: "fact",
                content: "x",
            });

            expect(ok).toBe(false);
            expect(upsertQdrantPoints).not.toHaveBeenCalled();
        });

        it("reports failure rather than throwing when Qdrant rejects", async () => {
            upsertQdrantPoints.mockRejectedValue(new Error("expected dim: 768, got 0"));

            const ok = await longTermMemoryService.index(1, {
                organizationId: 1,
                type: "fact",
                content: "x",
            });

            expect(ok).toBe(false);
        });
    });
});
