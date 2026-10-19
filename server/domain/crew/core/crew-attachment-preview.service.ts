/**
 * How room uploads appear in the conversation.
 *
 * An upload posts one turn from the person who uploaded, carrying a
 * `room_attachments` card: images as thumbnails, documents as preview cards
 * (type, size, and the opening lines of the text the server extracted). The
 * turn's text names the files, so the agents know they were shared; the files
 * themselves reach the agents through the project knowledge they are indexed
 * into.
 *
 * Thumbnails are made on request (GET /:key/attachments/:id/thumbnail?w=) and
 * kept in a small in-memory cache, so the chat never sends a full-size photo to
 * show a preview.
 */
import sharp from "sharp";

export interface AttachmentCardItem {
    id: number;
    name: string;
    mimeType: string | null;
    byteSize: number;
    /** "image" draws a thumbnail; anything else a document card. */
    kind: "image" | "document";
    parseStatus: string;
    /** Opening of the extracted text, for a document card. */
    preview: string | null;
}

/** Image types the thumbnailer reads (sharp's input formats, minus vector SVG). */
const THUMBNAILABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/tiff", "image/heic", "image/heif"]);

export function isThumbnailable(mimeType: string | null | undefined): boolean {
    return !!mimeType && THUMBNAILABLE.has(mimeType.toLowerCase());
}

/** Widths are snapped to a few sizes, so the cache holds a handful of variants, not one per request. */
export function snapWidth(raw: unknown): number {
    const w = Number(raw);
    const sizes = [160, 320, 480, 640, 960];
    if (!Number.isFinite(w) || w <= 0) return 320;
    return sizes.find((s) => s >= w) ?? sizes[sizes.length - 1];
}

const cache = new Map<string, Buffer>();
const CACHE_LIMIT = 300;

/**
 * A WebP no wider or taller than `width`, oriented from EXIF, never enlarged.
 * Metadata (EXIF location included) is not carried into the thumbnail.
 */
export async function thumbnail(cacheKey: string, bytes: Buffer, width: number): Promise<Buffer> {
    const key = `${cacheKey}:${width}`;
    const hit = cache.get(key);
    if (hit) {
        // Refresh recency.
        cache.delete(key);
        cache.set(key, hit);
        return hit;
    }
    const out = await sharp(bytes, { failOn: "none" })
        .rotate()
        .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 72 })
        .toBuffer();
    cache.set(key, out);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    return out;
}

/** The card items for files just uploaded, from the room's attachment list. */
export function attachmentCardItems(
    summaries: Array<{ id: number; displayName: string; mimeType: string | null; byteSize: number; parseStatus: string; parseType: string | null; preview: string | null }>,
    uploadedIds: number[],
): AttachmentCardItem[] {
    const wanted = new Set(uploadedIds);
    return summaries
        .filter((s) => wanted.has(s.id))
        .sort((a, b) => uploadedIds.indexOf(a.id) - uploadedIds.indexOf(b.id))
        .map((s) => ({
            id: s.id,
            name: s.displayName,
            mimeType: s.mimeType,
            byteSize: s.byteSize,
            kind: isThumbnailable(s.mimeType) || s.parseType === "image" ? "image" : "document",
            parseStatus: s.parseStatus,
            preview: s.preview ? s.preview.slice(0, 280) : null,
        }));
}

/** The turn's words: what the agents read about the upload. */
export function attachmentTurnText(items: AttachmentCardItem[]): string {
    const names = items.map((i) => i.name).join(", ");
    return `📎 Shared ${items.length} ${items.length === 1 ? "file" : "files"}: ${names}`;
}
