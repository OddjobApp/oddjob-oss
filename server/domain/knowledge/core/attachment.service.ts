import { createHash } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { fileBlobs, crewAttachments, crewSessions, projects } from "@shared/schema/index.js";
import { FileParser } from "@domain/core/infrastructure/file-parser.service.js";
import { getBlobStore } from "./blob-storage.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AttachmentService");

/**
 * Attachments: stored bytes a room can point at.
 *
 * The Copilot's existing upload path parses into a Redis cache under a TTL and
 * never writes the bytes anywhere, so nothing survives the conversation. This
 * persists, deduplicates by content, and parses exactly once — the same file
 * attached in three rooms is one blob, one parse, one future embedding.
 *
 * Scope is the project. `crew_attachments.project_id` is NOT NULL, and every
 * read here filters on it.
 */

/**
 * What the room and the Files tab render. Deliberately reports parse and index
 * state rather than hiding them: an attachment that failed to parse must not
 * look like one with no content.
 */
export interface AttachmentSummary {
    id: number;
    displayName: string;
    mimeType: string | null;
    byteSize: number;
    parseStatus: string;
    parseType: string | null;
    /** Full length before any chunking — null when nothing was extracted. */
    textLength: number | null;
    indexStatus: string;
    uploadedBy: string | null;
    createdAt: string | null;
    /** First lines of extracted text, for a preview. Never the whole document. */
    preview: string | null;
}

const PREVIEW_CHARS = 280;

/** Sources whose true character count is knowable from the bytes themselves. */
function isTextLike(mimeType: string, originalName: string): boolean {
    const ext = originalName.split(".").pop()?.toLowerCase() ?? "";
    return (
        mimeType.startsWith("text/") ||
        mimeType === "application/json" ||
        mimeType === "application/xml" ||
        ["txt", "md", "markdown", "csv", "json", "xml", "bpmn", "log", "yaml", "yml"].includes(ext)
    );
}

function toSummary(row: any): AttachmentSummary {
    const text: string | null = row.parsedText ?? null;
    return {
        id: row.attachmentId,
        displayName: row.displayName,
        mimeType: row.mimeType ?? null,
        byteSize: row.byteSize,
        parseStatus: row.parseStatus,
        parseType: row.parseType ?? null,
        textLength: row.textLength ?? null,
        indexStatus: row.indexStatus,
        uploadedBy: row.uploadedBy ?? null,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
        preview: text ? text.slice(0, PREVIEW_CHARS) : null,
    };
}

export const attachmentService = {
    /**
     * Stores a file and attaches it to a room.
     *
     * Idempotent on both levels: identical bytes reuse the blob (and its parse),
     * and re-attaching to the same room returns the existing reference rather
     * than duplicating it.
     */
    async attachToRoom(input: {
        orgId: number;
        projectId: number;
        sessionId: number;
        buffer: Buffer;
        originalName: string;
        mimeType: string;
        uploadedBy?: string | null;
    }) {
        const contentHash = createHash("sha256").update(input.buffer).digest("hex");

        let [blob] = await db
            .select()
            .from(fileBlobs)
            .where(and(eq(fileBlobs.orgId, input.orgId), eq(fileBlobs.contentHash, contentHash)))
            .limit(1);

        if (!blob) {
            // The store decides its own layout; this never builds a path.
            const target = await getBlobStore().put(contentHash, input.buffer);

            const parsed = await this.parse(input.buffer, input.mimeType, input.originalName, input.orgId);


            [blob] = await db
                .insert(fileBlobs)
                .values({
                    orgId: input.orgId,
                    contentHash,
                    storagePath: target,
                    byteSize: input.buffer.byteLength,
                    mimeType: input.mimeType,
                    originalName: input.originalName,
                    ...parsed,
                })
                .onConflictDoUpdate({
                    // Another request may have inserted the same hash between the
                    // select and here. Take theirs rather than failing the upload.
                    target: [fileBlobs.orgId, fileBlobs.contentHash],
                    set: { updatedAt: new Date() },
                })
                .returning();
        }

        const [attachment] = await db
            .insert(crewAttachments)
            .values({
                orgId: input.orgId,
                projectId: input.projectId,
                sessionId: input.sessionId,
                blobId: blob.id,
                displayName: input.originalName,
                uploadedBy: input.uploadedBy ?? null,
            })
            .onConflictDoUpdate({
                target: [crewAttachments.sessionId, crewAttachments.blobId],
                set: { displayName: input.originalName },
            })
            .returning();

        logger.info(
            `Attached ${input.originalName} to session ${input.sessionId} (blob ${blob.id}, ${blob.parseStatus})`,
        );

        return { attachment, blob };
    },

    /**
     * Parses once, at ingest.
     *
     * An unparseable file is recorded as such rather than stored as mojibake:
     * FileParser's text fallback would otherwise turn a .docx into garbage that
     * then gets embedded as if it were content.
     */
    async parse(buffer: Buffer, mimeType: string, originalName: string, organizationId?: number) {
        // Images go to a vision model rather than FileParser, whose image branch
        // stores base64 with the summary "Image file: name.png" — the filename,
        // which tells an agent nothing. The transcribed text is written into
        // parsedText so it is ordinary searchable content: a screenshot of an
        // error, a photo of a whiteboard and a scanned invoice all become
        // retrievable rather than opaque.
        const { imageRecognitionService } = await import("./image-recognition.service.js");
        if (imageRecognitionService.isSupported(mimeType)) {
            try {
                const reading = await imageRecognitionService.read(buffer, mimeType, originalName, organizationId);
                // OCR text first: it is the verbatim content. The description is
                // appended so a search for words that only appear in the caption
                // still finds the image.
                const text = [reading.text, reading.description].filter(Boolean).join("\n\n");
                return {
                    parseStatus: "parsed" as const,
                    parseType: "image",
                    parsedText: text || null,
                    textLength: text.length,
                    parsedData: {
                        // Marked inferred throughout — a diagram read from pixels
                        // is not a parse, and synthesis must be able to tell.
                        provenance: "inferred",
                        model: reading.model,
                        description: reading.description,
                        ocrText: reading.text,
                        isDiagram: reading.isDiagram,
                        processGraph: reading.processGraph,
                    },
                    parseError: null,
                };
            } catch (error: any) {
                // The upload still succeeds; the image is simply unread. Recorded
                // rather than swallowed, so "we could not read it" is visible and
                // a retry has something to select on.
                logger.warn(`Could not read image ${originalName}: ${error?.message}`);
                return {
                    parseStatus: "failed" as const,
                    parseType: "image",
                    parsedText: null,
                    textLength: null,
                    parsedData: null,
                    parseError: String(error?.message ?? error).slice(0, 500),
                };
            }
        }

        try {
            // No maxTextLength: an attachment keeps its full text. Chunking for
            // retrieval happens at index time, where a chunk is a unit of
            // meaning — truncating here would throw the rest away permanently.
            const parsed = await FileParser.parse(buffer, mimeType, originalName);

            if (parsed.type === "unsupported") {
                // A type we decline to read is recorded as such. It must not
                // become an empty "parsed" document, which would be
                // indistinguishable from a file that genuinely had no content.
                return {
                    parseStatus: "unsupported" as const,
                    parseType: null,
                    parsedText: null,
                    textLength: null,
                    parsedData: null,
                    parseError: parsed.summary ?? "Unsupported file type.",
                };
            }

            const text =
                typeof parsed.content === "string"
                    ? parsed.content
                    : parsed.summary ?? null;

            // FileParser truncates plain text at 10,000 characters. Recording
            // the truncated length would make a preview indistinguishable from
            // the whole document — the very failure this column exists to
            // prevent. For text-like sources the true length is knowable from
            // the bytes, so `textLength > parsedText.length` IS the truncation
            // signal until chunking replaces truncation outright.
            const sourceLength = isTextLike(mimeType, originalName)
                ? buffer.toString("utf-8").length
                : null;

            return {
                parseStatus: "parsed" as const,
                parseType: parsed.type,
                parsedText: text,
                textLength: sourceLength ?? (text ? text.length : 0),
                // Structured extraction stays out of parsedText so retrieval does
                // not embed a JSON blob as if it were prose.
                parsedData:
                    typeof parsed.content === "object" && parsed.content !== null
                        ? { content: parsed.content, summary: parsed.summary ?? null }
                        : null,
                parseError: null,
            };
        } catch (error: any) {
            logger.warn(`Failed to parse ${originalName}: ${error?.message}`);
            return {
                parseStatus: "failed" as const,
                parseType: null,
                parsedText: null,
                textLength: null,
                parsedData: null,
                parseError: String(error?.message ?? error).slice(0, 500),
            };
        }
    },

    /** Detach one file from a room. False when it is not attached to this room. */
    async removeFromSession(orgId: number, sessionId: number, attachmentId: number): Promise<boolean> {
        const removed = await db.delete(crewAttachments)
            .where(and(eq(crewAttachments.orgId, orgId), eq(crewAttachments.sessionId, sessionId), eq(crewAttachments.id, attachmentId)))
            .returning({ id: crewAttachments.id });
        return removed.length > 0;
    },

    /** Everything attached to one room, newest first. */
    async listForSession(orgId: number, sessionId: number): Promise<AttachmentSummary[]> {
        const rows = await db
            .select({
                attachmentId: crewAttachments.id,
                displayName: crewAttachments.displayName,
                uploadedBy: crewAttachments.uploadedBy,
                createdAt: crewAttachments.createdAt,
                mimeType: fileBlobs.mimeType,
                byteSize: fileBlobs.byteSize,
                parseStatus: fileBlobs.parseStatus,
                parseType: fileBlobs.parseType,
                parsedText: fileBlobs.parsedText,
                textLength: fileBlobs.textLength,
                indexStatus: fileBlobs.indexStatus,
            })
            .from(crewAttachments)
            .innerJoin(fileBlobs, eq(fileBlobs.id, crewAttachments.blobId))
            .where(and(eq(crewAttachments.orgId, orgId), eq(crewAttachments.sessionId, sessionId)))
            .orderBy(desc(crewAttachments.createdAt));

        return rows.map(toSummary);
    },

    /**
     * Everything attached anywhere in a project — what the Files tab lists.
     *
     * Scoped by project, never by org alone: a document attached in one project
     * must not appear in another's file list.
     */
    async listForProject(orgId: number, projectId: number) {
        const rows = await db
            .select({
                attachmentId: crewAttachments.id,
                displayName: crewAttachments.displayName,
                uploadedBy: crewAttachments.uploadedBy,
                createdAt: crewAttachments.createdAt,
                mimeType: fileBlobs.mimeType,
                byteSize: fileBlobs.byteSize,
                parseStatus: fileBlobs.parseStatus,
                parseType: fileBlobs.parseType,
                parsedText: fileBlobs.parsedText,
                textLength: fileBlobs.textLength,
                indexStatus: fileBlobs.indexStatus,
                sessionKey: crewSessions.sessionKey,
                roomTitle: crewSessions.title,
            })
            .from(crewAttachments)
            .innerJoin(fileBlobs, eq(fileBlobs.id, crewAttachments.blobId))
            .innerJoin(crewSessions, eq(crewSessions.id, crewAttachments.sessionId))
            .where(and(eq(crewAttachments.orgId, orgId), eq(crewAttachments.projectId, projectId)))
            .orderBy(desc(crewAttachments.createdAt));

        return rows.map((row) => ({
            ...toSummary(row),
            // Where it came from, so the Files tab can link back to the room.
            sessionKey: row.sessionKey,
            roomTitle: row.roomTitle ?? null,
        }));
    },

    /** The stored bytes, for download. Scoped so one project cannot read another's. */
    async readBlob(orgId: number, projectId: number, attachmentId: number) {
        const [row] = await db
            .select({
                storagePath: fileBlobs.storagePath,
                mimeType: fileBlobs.mimeType,
                displayName: crewAttachments.displayName,
            })
            .from(crewAttachments)
            .innerJoin(fileBlobs, eq(fileBlobs.id, crewAttachments.blobId))
            .where(and(
                eq(crewAttachments.id, attachmentId),
                eq(crewAttachments.orgId, orgId),
                eq(crewAttachments.projectId, projectId),
            ))
            .limit(1);

        if (!row) return null;
        return { ...row, bytes: await getBlobStore().get(row.storagePath) };
    },

    /** Replace one text attachment with a new immutable blob revision. */
    async updateText(orgId: number, projectId: number, attachmentId: number, content: string) {
        const current = await this.readBlob(orgId, projectId, attachmentId);
        if (!current) return null;
        if (!isTextLike(current.mimeType || "text/plain", current.displayName)) {
            throw new Error("Only text and Markdown project files can be edited here.");
        }

        const bytes = Buffer.from(content, "utf-8");
        const contentHash = createHash("sha256").update(bytes).digest("hex");
        let [blob] = await db.select().from(fileBlobs).where(and(
            eq(fileBlobs.orgId, orgId),
            eq(fileBlobs.contentHash, contentHash),
        )).limit(1);

        if (!blob) {
            const storagePath = await getBlobStore().put(contentHash, bytes);
            [blob] = await db.insert(fileBlobs).values({
                orgId,
                contentHash,
                storagePath,
                byteSize: bytes.byteLength,
                mimeType: current.mimeType || "text/plain",
                originalName: current.displayName,
                parseStatus: "parsed",
                parseType: "text",
                parsedText: content,
                textLength: content.length,
                indexStatus: "pending",
            }).onConflictDoUpdate({
                target: [fileBlobs.orgId, fileBlobs.contentHash],
                set: { updatedAt: new Date() },
            }).returning();
        }

        await db.update(crewAttachments).set({ blobId: blob.id }).where(and(
            eq(crewAttachments.id, attachmentId),
            eq(crewAttachments.orgId, orgId),
            eq(crewAttachments.projectId, projectId),
        ));
        return { attachmentId, byteSize: bytes.byteLength, textLength: content.length };
    },
};
