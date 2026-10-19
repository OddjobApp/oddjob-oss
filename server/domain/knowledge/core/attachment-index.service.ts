import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { fileBlobs, crewAttachments } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import { createHash } from "crypto";
import { DEFAULT_SECURITY_CLASSIFICATION } from "./rag-langchain.service.js";

const logger = createLogger("AttachmentIndex");

/**
 * Qdrant point ids must be UUIDs. Derived from the blob and chunk index so a
 * re-index overwrites the same points instead of accumulating duplicates.
 */
function deterministicUUID(input: string): string {
    const h = createHash("sha256").update(input).digest("hex");
    return [h.slice(0,8), h.slice(8,12), "4"+h.slice(13,16), "8"+h.slice(17,20), h.slice(20,32)].join("-");
}

/**
 * Making an attachment retrievable.
 *
 * Reuses the existing RAG primitives — the same splitter, embeddings, sharded
 * `oddjob_org_<id>` collections and Qdrant client — rather than standing up a
 * parallel store. What it adds is the scoping this platform kept getting wrong:
 * every chunk carries BOTH organizationId and projectId, and every search
 * filters on both. A reindex that once dropped the org wrote to the wrong shard,
 * which is indistinguishable from a document that was never embedded at all.
 *
 * Index state is written only after Qdrant confirms, for the same reason
 * `qdrant_point_id` now is: a row that claims to be indexed while nothing is
 * searchable is worse than one that admits it failed.
 */

export interface IndexResult {
    indexed: boolean;
    chunks: number;
    reason?: "no_content" | "already_indexed";
}

/** Chunks carry the attachment's identity so a hit can be traced to its file. */
interface AttachmentChunkMetadata {
    organizationId: number;
    projectId: number;
    blobId: number;
    attachmentId: number;
    sessionId: number;
    displayName: string;
    assetType: "attachment";
    sourceType: "attachment";
    chunkIndex: number;
    chunkId: string;
    assetKey: string;
    name: string;
    assetId: number;
}

export const attachmentIndexService = {
    /**
     * Embeds one attachment's text.
     *
     * Idempotent: the point ids are derived from the blob id and chunk index, so
     * re-indexing overwrites in place rather than accumulating duplicates.
     */
    async indexAttachment(attachmentId: number, orgId: number): Promise<IndexResult> {
        const [row] = await db
            .select({
                attachmentId: crewAttachments.id,
                projectId: crewAttachments.projectId,
                sessionId: crewAttachments.sessionId,
                displayName: crewAttachments.displayName,
                blobId: fileBlobs.id,
                parsedText: fileBlobs.parsedText,
                parseStatus: fileBlobs.parseStatus,
            })
            .from(crewAttachments)
            .innerJoin(fileBlobs, eq(fileBlobs.id, crewAttachments.blobId))
            .where(and(eq(crewAttachments.id, attachmentId), eq(crewAttachments.orgId, orgId)))
            .limit(1);

        if (!row) throw new Error(`Attachment ${attachmentId} not found for organization ${orgId}.`);

        const text = row.parsedText?.trim() ?? "";
        if (!text) {
            // An image with no readable text, or an unsupported type. Not an
            // error — but emphatically not indexed, and recorded as 'skipped'
            // so it is distinguishable from a pending one.
            await this.setStatus(row.blobId, "skipped", null);
            return { indexed: false, chunks: 0, reason: "no_content" };
        }

        try {
            const { getEmbeddings } = await import("./rag-langchain.service.js");
            const { ensureQdrantCollection, upsertQdrantPoints } = await import(
                "@server/integrations/qdrant-client.js"
            );
            const { RecursiveCharacterTextSplitter } = await import("@langchain/textsplitters");

            const splitter = new RecursiveCharacterTextSplitter({
                chunkSize: Number(process.env.RAG_CHUNK_SIZE || 800),
                chunkOverlap: Number(process.env.RAG_CHUNK_OVERLAP || 100),
            });
            const chunks = await splitter.splitText(text);

            if (chunks.length === 0) {
                // Text present but chunking produced nothing — a failure, not an
                // empty document. Same shape as the reindex bug fixed in the
                // knowledge store: never report this as success.
                throw new Error(
                    `Chunking produced 0 chunks from ${text.length} characters of text.`,
                );
            }

            const embeddings = getEmbeddings();
            const vectors = await embeddings.embedDocuments(chunks);

            if (vectors.length !== chunks.length) {
                throw new Error(`Embedded ${vectors.length} vectors for ${chunks.length} chunks.`);
            }
            // An embedding provider over its spending cap has resolved an EMPTY
            // vector rather than throwing. That is what silently killed RAG, so
            // it is checked explicitly rather than trusted.
            const emptyVector = vectors.findIndex((v: number[]) => !Array.isArray(v) || v.length === 0);
            if (emptyVector !== -1) {
                throw new Error(
                    `Embedding returned an empty vector for chunk ${emptyVector} — refusing to record this as indexed.`,
                );
            }

            // Same sharding rule the RAG service uses — org-scoped collections,
            // so an attachment can never land in another organization's shard.
            const collection = `oddjob_org_${orgId}`;
            await ensureQdrantCollection(collection);

            const points = chunks.map((chunk, index) => {
                const metadata: AttachmentChunkMetadata = {
                    organizationId: orgId,
                    // The scoping that makes this safe. Carried on every chunk so
                    // a filter cannot be forgotten at read time.
                    projectId: row.projectId,
                    blobId: row.blobId,
                    attachmentId: row.attachmentId,
                    sessionId: row.sessionId,
                    displayName: row.displayName,
                    assetType: "attachment",
                    sourceType: "attachment",
                    chunkIndex: index,
                    chunkId: deterministicUUID(`attachment-${row.blobId}:${index}`),
                    assetKey: `attachment-${row.blobId}`,
                    name: row.displayName,
                    assetId: row.blobId,
                };
                return {
                    // Deterministic, so re-indexing overwrites rather than
                    // accumulating a second copy of every chunk.
                    id: metadata.chunkId,
                    vector: vectors[index],
                    // securityClassification is REQUIRED, not decorative: search-service
                    // filters vector hits on it with a Qdrant range, which excludes any
                    // point lacking the key. An attachment chunk indexed without it is
                    // not "unclassified" — it is unreachable by search.
                    payload: {
                        ...metadata,
                        content: chunk,
                        pageContent: chunk,
                        securityClassification: DEFAULT_SECURITY_CLASSIFICATION,
                    },
                };
            });

            await upsertQdrantPoints(points, collection);

            await this.setStatus(row.blobId, "indexed", null);
            logger.info(`Indexed attachment ${attachmentId} as ${points.length} chunks in ${collection}`);
            return { indexed: true, chunks: points.length };
        } catch (error: any) {
            await this.setStatus(row.blobId, "failed", String(error?.message ?? error).slice(0, 500));
            logger.error(`Failed to index attachment ${attachmentId}: ${error?.message}`);
            throw error;
        }
    },

    /**
     * Searches attachments scoped by project or session.
     *
     * At least one of `projectId` or `sessionId` is required to ensure isolation.
     */
    async search(input: {
        query: string;
        orgId: number;
        projectId?: number | null;
        limit?: number;
        sessionId?: number;
    }) {
        const { retrieveSimilarDocuments } = await import("./rag-langchain.service.js");
        if (input.projectId == null && input.sessionId == null) throw new Error('Attachment search requires a project or room.');

        const must: Array<Record<string, any>> = [
            { key: "assetType", match: { value: "attachment" } },
        ];
        if (input.projectId != null) {
            must.push({ key: "projectId", match: { value: input.projectId } });
        }
        // Optionally narrow to one room, or scope ad-hoc room searches
        if (input.sessionId != null) {
            must.push({ key: "sessionId", match: { value: input.sessionId } });
        }

        const docs = await retrieveSimilarDocuments(input.query, {
            organizationId: input.orgId,
            k: input.limit ?? 6,
            filter: { must },
        });

        // Vector indexing is asynchronous. The current room links, rather than
        // stale vector metadata, determine whether a detached file is eligible.
        const current = await db.select({ id: crewAttachments.id }).from(crewAttachments).where(and(
            eq(crewAttachments.orgId, input.orgId),
            input.projectId != null ? eq(crewAttachments.projectId, input.projectId) : undefined,
            input.sessionId != null ? eq(crewAttachments.sessionId, input.sessionId) : undefined,
        ));
        const eligible = new Set(current.map(row => row.id));
        return docs.filter((doc: any) => eligible.has(Number(doc.metadata?.attachmentId))).map((doc: any) => ({
            attachmentId: doc.metadata?.attachmentId ?? null,
            displayName: doc.metadata?.displayName ?? doc.metadata?.name ?? "Attachment",
            chunkIndex: doc.metadata?.chunkIndex ?? null,
            score: doc.score ?? null,
            content: doc.pageContent ?? doc.metadata?.content ?? "",
        }));
    },

    /** Index state is written in one place, so it cannot drift per call site. */
    async setStatus(blobId: number, status: "pending" | "indexed" | "skipped" | "failed", error: string | null) {
        await db
            .update(fileBlobs)
            .set({
                indexStatus: status,
                indexError: error,
                indexedAt: status === "indexed" ? new Date() : null,
                updatedAt: new Date(),
            })
            .where(eq(fileBlobs.id, blobId));
    },
};
