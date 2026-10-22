import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("DocumentTextExtraction");

/**
 * Text for an uploaded knowledge document.
 *
 * Uploads arrive as base64 file data. Nothing turned that into text: a document
 * was searchable only if the browser happened to send `textContent`, and the
 * Knowledge uploader does not — so an uploaded Markdown file, PDF or scan was
 * stored, never indexed, and invisible to search and agents.
 *
 * Reading goes through the same parser as CREW attachments
 * (attachmentService.parse): text formats, PDF, Word and Excel are parsed
 * locally; images are read by the organization's own model.
 */

export type ExtractionStatus = "extracted" | "empty" | "unsupported" | "failed";

export interface ExtractionResult {
    text: string | null;
    status: ExtractionStatus;
    error?: string;
}

/** Decode stored file data: raw base64 or a data: URL. */
export function decodeFileData(fileData: string): { buffer: Buffer; mimeFromData: string | null } {
    const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(fileData);
    if (match) {
        const payload = match[3];
        const buffer = match[2] ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf-8");
        return { buffer, mimeFromData: match[1] ?? null };
    }
    return { buffer: Buffer.from(fileData, "base64"), mimeFromData: null };
}

export async function extractUploadedText(
    input: { fileData: string; contentType?: string | null; title: string },
    organizationId: number | null,
): Promise<ExtractionResult> {
    try {
        const { buffer, mimeFromData } = decodeFileData(input.fileData);
        if (buffer.length === 0) return { text: null, status: "empty" };
        const mime = input.contentType || mimeFromData || "";
        const { attachmentService } = await import("./attachment.service.js");
        const parsed = await attachmentService.parse(buffer, mime, input.title, organizationId ?? undefined);
        if (parsed.parseStatus === "unsupported") {
            return { text: null, status: "unsupported", error: parsed.parseError ?? undefined };
        }
        if (parsed.parseStatus === "failed") {
            return { text: null, status: "failed", error: parsed.parseError ?? undefined };
        }
        const text = parsed.parsedText?.trim() ? parsed.parsedText : null;
        return { text, status: text ? "extracted" : "empty" };
    } catch (error: any) {
        logger.warn(`Could not extract text from "${input.title}": ${error?.message}`);
        return { text: null, status: "failed", error: String(error?.message ?? error).slice(0, 500) };
    }
}

/** The metadata block recorded with a document, so a failed read is visible and retryable. */
export function extractionMetadata(result: ExtractionResult): Record<string, unknown> {
    return {
        status: result.status,
        ...(result.error ? { error: result.error } : {}),
        characters: result.text?.length ?? 0,
        at: new Date().toISOString(),
    };
}

export interface ReextractSummary {
    checked: number;
    extracted: number;
    empty: number;
    unsupported: number;
    failed: number;
    documents: Array<{ id: number; title: string; status: ExtractionStatus; error?: string }>;
}

/**
 * Read the text of the organization's uploaded documents that were saved without
 * any, and hand each result to `update` (which stores it and re-indexes the
 * document once it has text). The organization is the caller's; nothing else.
 */
export async function reextractUploadedDocuments(
    organizationId: number,
    update: (documentId: number, patch: { textContent?: string; metadata: Record<string, any> }) => Promise<unknown>,
): Promise<ReextractSummary> {
    const { db } = await import("@server/database_service.js");
    const { knowledgeDocuments } = await import("@shared/schema/index.js");
    const { and, eq, isNotNull, sql } = await import("drizzle-orm");
    const docs = await db.select({
        id: knowledgeDocuments.id, title: knowledgeDocuments.title, fileData: knowledgeDocuments.fileData,
        contentType: knowledgeDocuments.contentType, metadata: knowledgeDocuments.metadata,
    }).from(knowledgeDocuments).where(and(
        eq(knowledgeDocuments.organizationId, organizationId),
        eq(knowledgeDocuments.sourceType, "upload"),
        isNotNull(knowledgeDocuments.fileData),
        sql`coalesce(btrim(${knowledgeDocuments.textContent}), '') = ''`,
    ));
    const summary: ReextractSummary = { checked: docs.length, extracted: 0, empty: 0, unsupported: 0, failed: 0, documents: [] };
    for (const doc of docs) {
        const result = await extractUploadedText({ fileData: doc.fileData!, contentType: doc.contentType, title: doc.title }, organizationId);
        summary[result.status]++;
        summary.documents.push({ id: doc.id, title: doc.title, status: result.status, ...(result.error ? { error: result.error } : {}) });
        await update(doc.id, {
            ...(result.text ? { textContent: result.text } : {}),
            metadata: { ...((doc.metadata as Record<string, any>) ?? {}), extraction: extractionMetadata(result) },
        });
    }
    logger.info(`Re-extracted ${summary.extracted} of ${summary.checked} uploaded document(s) for organization ${organizationId}`);
    return summary;
}
