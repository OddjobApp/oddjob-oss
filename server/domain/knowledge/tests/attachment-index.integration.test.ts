import { describe, expect, it, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { eq, inArray } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { fileBlobs, crewAttachments, crewSessions } from "@shared/schema/index.js";

/**
 * Index state is a claim that something is searchable. Like qdrant_point_id, it
 * has to be earned — the failure this pins is an embedding provider over its
 * spending cap resolving an EMPTY vector rather than throwing, which once let
 * rows record themselves as indexed while nothing was retrievable.
 */

const ORG = 1;
const PROJECT = 19;

const embedDocuments = vi.fn();
const upsertQdrantPoints = vi.fn();
const ensureQdrantCollection = vi.fn();
const retrieveSimilarDocuments = vi.fn();

vi.mock("@domain/knowledge/core/rag-langchain.service.js", async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, getEmbeddings: () => ({ embedDocuments }), retrieveSimilarDocuments };
});

vi.mock("@server/integrations/qdrant-client.js", async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, upsertQdrantPoints, ensureQdrantCollection };
});

let attachmentService: any;
let attachmentIndexService: any;
let sessionIds: number[] = [];
let blobIds: number[] = [];

beforeAll(async () => {
    process.env.ATTACHMENT_STORAGE_ROOT = await fs.mkdtemp(path.join(os.tmpdir(), "oddjob-idx-"));
    ({ attachmentService } = await import("../core/attachment.service.js"));
    ({ attachmentIndexService } = await import("../core/attachment-index.service.js"));
});

beforeEach(() => {
    embedDocuments.mockReset();
    upsertQdrantPoints.mockReset();
    ensureQdrantCollection.mockReset();
    retrieveSimilarDocuments.mockReset();
});

afterEach(async () => {
    if (sessionIds.length) await db.delete(crewSessions).where(inArray(crewSessions.id, sessionIds));
    if (blobIds.length) await db.delete(fileBlobs).where(inArray(fileBlobs.id, blobIds));
    sessionIds = [];
    blobIds = [];
});

async function attachedFile(text: string, name = "doc.txt") {
    const [session] = await db
        .insert(crewSessions)
        .values({ organizationId: ORG, sessionKey: `crew-idx-${Date.now()}-${Math.random()}`, projectId: PROJECT })
        .returning({ id: crewSessions.id });
    sessionIds.push(session.id);

    const { attachment, blob } = await attachmentService.attachToRoom({
        orgId: ORG, projectId: PROJECT, sessionId: session.id,
        buffer: Buffer.from(text), originalName: name, mimeType: "text/plain",
    });
    blobIds.push(blob.id);
    return { attachmentId: attachment.id, blobId: blob.id, sessionId: session.id };
}

const statusOf = async (blobId: number) =>
    (await db.select().from(fileBlobs).where(eq(fileBlobs.id, blobId)).limit(1))[0];

describe("indexing an attachment", () => {
    it("records indexed only after the vector store accepts the points", async () => {
        const { attachmentId, blobId } = await attachedFile("Some genuinely indexable prose.");
        embedDocuments.mockResolvedValue([[0.1, 0.2, 0.3]]);

        const result = await attachmentIndexService.indexAttachment(attachmentId, ORG);

        expect(result).toMatchObject({ indexed: true, chunks: 1 });
        expect(upsertQdrantPoints).toHaveBeenCalledTimes(1);
        const row = await statusOf(blobId);
        expect(row.indexStatus).toBe("indexed");
        expect(row.indexedAt).not.toBeNull();
    });

    it("refuses to record success when the provider returns an empty vector", async () => {
        const { attachmentId, blobId } = await attachedFile("Content that should have embedded.");
        // The spending-cap failure: resolves, but with nothing in it.
        embedDocuments.mockResolvedValue([[]]);

        await expect(attachmentIndexService.indexAttachment(attachmentId, ORG)).rejects.toThrow(/empty vector/i);

        expect(upsertQdrantPoints).not.toHaveBeenCalled();
        const row = await statusOf(blobId);
        expect(row.indexStatus).toBe("failed");
        expect(row.indexError).toMatch(/empty vector/i);
    });

    it("records the reason when the store itself rejects the write", async () => {
        const { attachmentId, blobId } = await attachedFile("More prose.");
        embedDocuments.mockResolvedValue([[0.1]]);
        upsertQdrantPoints.mockRejectedValue(new Error("Qdrant unreachable"));

        await expect(attachmentIndexService.indexAttachment(attachmentId, ORG)).rejects.toThrow(/unreachable/);

        const row = await statusOf(blobId);
        expect(row.indexStatus).toBe("failed");
        expect(row.indexedAt).toBeNull();
    });

    it("marks a file with nothing to embed as skipped, not indexed", async () => {
        const { attachmentId, blobId } = await attachedFile("   ");

        const result = await attachmentIndexService.indexAttachment(attachmentId, ORG);

        // Distinguishable from pending AND from indexed — the whole point.
        expect(result).toMatchObject({ indexed: false, reason: "no_content" });
        expect((await statusOf(blobId)).indexStatus).toBe("skipped");
        expect(embedDocuments).not.toHaveBeenCalled();
    });

    it("stamps every chunk with the project, so a search cannot forget the scope", async () => {
        const { attachmentId } = await attachedFile("A".repeat(2500));
        embedDocuments.mockImplementation(async (chunks: string[]) => chunks.map(() => [0.1, 0.2]));

        await attachmentIndexService.indexAttachment(attachmentId, ORG);

        const [points, collection] = upsertQdrantPoints.mock.calls[0];
        expect(collection).toBe(`oddjob_org_${ORG}`);
        expect(points.length).toBeGreaterThan(1);
        for (const point of points) {
            expect(point.payload.projectId).toBe(PROJECT);
            expect(point.payload.organizationId).toBe(ORG);
        }
    });

    it("re-indexing overwrites the same points instead of duplicating them", async () => {
        const { attachmentId } = await attachedFile("Stable content.");
        embedDocuments.mockResolvedValue([[0.1]]);

        await attachmentIndexService.indexAttachment(attachmentId, ORG);
        const firstIds = upsertQdrantPoints.mock.calls[0][0].map((p: any) => p.id);
        await attachmentIndexService.indexAttachment(attachmentId, ORG);
        const secondIds = upsertQdrantPoints.mock.calls[1][0].map((p: any) => p.id);

        expect(secondIds).toEqual(firstIds);
    });
});

describe("searching attachments", () => {
    it("always filters by project and by attachment type", async () => {
        retrieveSimilarDocuments.mockResolvedValue([]);

        await attachmentIndexService.search({ query: "pricing", orgId: ORG, projectId: PROJECT });

        const [, options] = retrieveSimilarDocuments.mock.calls[0];
        expect(options.organizationId).toBe(ORG);
        expect(options.filter.must).toEqual(
            expect.arrayContaining([
                { key: "projectId", match: { value: PROJECT } },
                { key: "assetType", match: { value: "attachment" } },
            ]),
        );
    });

    it("returns the passage with the file it came from, so a claim can cite it", async () => {
        const { attachmentId } = await attachedFile("Payment terms are net 30.", "contract.pdf");
        retrieveSimilarDocuments.mockResolvedValue([
            { pageContent: "Payment terms are net 30.", score: 0.82,
              metadata: { attachmentId, displayName: "contract.pdf", chunkIndex: 3 } },
        ]);

        const [hit] = await attachmentIndexService.search({ query: "payment", orgId: ORG, projectId: PROJECT });

        expect(hit).toMatchObject({
            attachmentId, displayName: "contract.pdf", chunkIndex: 3, content: "Payment terms are net 30.",
        });
    });

    it("leaves out a file detached from the room, though its vectors are still indexed", async () => {
        const { attachmentId, sessionId } = await attachedFile("Payment terms are net 30.", "contract.pdf");
        await attachmentService.removeFromSession(ORG, sessionId, attachmentId);
        retrieveSimilarDocuments.mockResolvedValue([
            { pageContent: "Payment terms are net 30.", score: 0.82,
              metadata: { attachmentId, displayName: "contract.pdf", chunkIndex: 0 } },
        ]);

        expect(await attachmentIndexService.search({ query: "payment", orgId: ORG, projectId: PROJECT })).toEqual([]);
    });
});
