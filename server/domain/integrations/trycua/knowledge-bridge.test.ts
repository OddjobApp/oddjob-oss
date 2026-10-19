/** @vitest-environment node */

/**
 * A DOM extract used to be written into knowledge_documents with a plain insert.
 * That skipped the embedding (so the content was findable by SQL only, never by
 * semantic search) and skipped the upsert on (project_id, title), so the second
 * extract of the same page raised a unique violation that the bridge swallowed
 * into `success: false`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { createDocument, rows, inserted, updated } = vi.hoisted(() => ({
    createDocument: vi.fn(),
    rows: { topic: [] as any[], node: [] as any[] },
    inserted: [] as Array<{ table: string; values: any }>,
    updated: [] as Array<{ table: string; values: any }>,
}));

/** Minimal Drizzle stand-in: enough to see which table each call touched. */
vi.mock("../../../db/index.js", () => {
    const nameOf = (table: any) => String(table?.[Symbol.for("drizzle:Name")] ?? table?._?.name ?? "unknown");
    return {
        db: {
            select: () => ({
                from: (table: any) => ({
                    where: () => ({
                        limit: async () => (nameOf(table).includes("topics") ? rows.topic : rows.node),
                    }),
                }),
            }),
            insert: (table: any) => ({
                values: (values: any) => {
                    inserted.push({ table: nameOf(table), values });
                    const returning = async () => [{ id: 7, ...values }];
                    return { returning, catch: (fn: any) => Promise.resolve().then(returning).catch(fn), then: (fn: any) => Promise.resolve().then(returning).then(fn) };
                },
            }),
            update: (table: any) => ({
                set: (values: any) => ({
                    where: () => ({ returning: async () => { updated.push({ table: nameOf(table), values }); return [{ id: 9, ...values }]; } }),
                }),
            }),
        },
    };
});

vi.mock("@domain/knowledge/core/knowledge.service.js", () => ({ knowledgeService: { createDocument } }));

const { trycuaKnowledgeBridge } = await import("./trycua-knowledge-bridge.js");

beforeEach(() => {
    vi.clearAllMocks();
    rows.topic = [{ id: 3, name: "Web Scraping" }];
    rows.node = [];
    inserted.length = 0;
    updated.length = 0;
    createDocument.mockResolvedValue({ id: 42, qdrantPointId: "point-1" });
});

describe("ingestScrapedContent", () => {
    it("files the extract through the indexed document path, not a raw insert", async () => {
        const result = await trycuaKnowledgeBridge.ingestScrapedContent({
            organizationId: 7,
            userId: "user-1",
            title: "Wikipedia (text)",
            url: "https://en.wikipedia.org/wiki/Honolulu",
            content: "Honolulu is the capital of Hawaii.",
            sourceSessionId: "session-1",
        });

        expect(createDocument).toHaveBeenCalledTimes(1);
        const [input, orgContext] = createDocument.mock.calls[0];
        expect(input).toMatchObject({
            title: "Wikipedia (text)",
            url: "https://en.wikipedia.org/wiki/Honolulu",
            textContent: "Honolulu is the capital of Hawaii.",
            sourceType: "integration",
        });
        expect(input.topicIds).toEqual([3]);
        expect(orgContext.organizationId).toBe(7);
        expect(inserted.some((i) => i.table.includes("documents"))).toBe(false);

        expect(result.success).toBe(true);
        expect(result.documentId).toBe(42);
        expect(result.indexedForSearch).toBe(true);
    });

    it("reports an extract the vector store has not confirmed as not yet searchable", async () => {
        createDocument.mockResolvedValue({ id: 43, qdrantPointId: null });

        const result = await trycuaKnowledgeBridge.ingestScrapedContent({
            organizationId: 7, title: "Page (text)", content: "body",
        });

        expect(result.success).toBe(true);
        expect(result.indexedForSearch).toBe(false);
        expect(result.message).toMatch(/search index is still catching up/);
    });

    it("updates the existing graph node when the same page is extracted again", async () => {
        rows.node = [{ id: 11, knowledgeDocumentId: 42 }];

        const result = await trycuaKnowledgeBridge.ingestScrapedContent({
            organizationId: 7, title: "Wikipedia (text)", content: "again",
        });

        expect(result.success).toBe(true);
        expect(updated.some((u) => u.table.includes("nodes"))).toBe(true);
        expect(inserted.some((i) => i.table.includes("nodes"))).toBe(false);
    });

    it("reports a failure instead of throwing at the tool", async () => {
        createDocument.mockRejectedValue(new Error("vector store unreachable"));

        const result = await trycuaKnowledgeBridge.ingestScrapedContent({
            organizationId: 7, title: "Page (text)", content: "body",
        });

        expect(result).toMatchObject({ success: false, message: "vector store unreachable" });
    });
});
