/**
 * What the studio should say about a publish once the modal has gone.
 *
 * Publishing showed a tick for 1600ms, closed the modal, and left nothing
 * behind — no version, no timestamp, no link to the asset. An author who
 * looked away for two seconds could not tell whether the publish had happened.
 *
 * None of that was missing from the data. publishDocument records the version,
 * the time, the word count and the attachment id in settings.publications and
 * has since it shipped; the field was written through an `as any` cast, never
 * declared, and never read.
 *
 * The part worth deriving rather than storing is whether the published asset
 * still matches the draft. A version tag on its own tells an author something
 * was published; what they need to know is whether it is the document they are
 * looking at.
 */

export interface PublicationRecord {
    versionTag: string;
    publishedAt: string;
    releaseNotes?: string;
    wordCount?: number;
    attachmentId?: number;
    theme?: string;
}

export interface PublishedState {
    versionTag: string;
    /** ISO, as stored. */
    publishedAt: string;
    wordCount?: number;
    releaseNotes?: string;
    /** Null when the publish predates attachment tracking. */
    downloadUrl: string | null;
    /**
     * Stations saved since the publish. Zero means the asset is the document.
     *
     * Derived rather than stored: a flag written at publish time would be wrong
     * from the author's next keystroke.
     */
    editedSince: number;
}

function parseTime(value: unknown): number | null {
    if (typeof value !== "string") return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
}

/** A stored entry that has the two fields the state is built on. */
function isUsable(entry: unknown): entry is PublicationRecord {
    const e = entry as PublicationRecord | null;
    return Boolean(e && typeof e.versionTag === "string" && parseTime(e.publishedAt) !== null);
}

/**
 * The most recent publish, and whether the draft has moved since.
 *
 * `publications` is stored newest first, but that is publishDocument's
 * convention rather than a guarantee, so the newest is chosen by timestamp.
 */
export function latestPublication(
    publications: unknown,
    nodes: Array<{ updatedAt?: string | Date | null }> = [],
): PublishedState | null {
    if (!Array.isArray(publications)) return null;

    const usable = publications.filter(isUsable);
    if (usable.length === 0) return null;

    const latest = usable.reduce((newest, entry) =>
        (parseTime(entry.publishedAt) ?? 0) > (parseTime(newest.publishedAt) ?? 0) ? entry : newest,
    );

    const publishedMs = parseTime(latest.publishedAt)!;
    const editedSince = nodes.filter((n) => {
        const saved = parseTime(typeof n.updatedAt === "string" ? n.updatedAt : n.updatedAt?.toISOString());
        // An unreadable timestamp is not evidence of an edit. Claiming the asset
        // is out of date when it is not would send the author to republish for
        // nothing.
        return saved !== null && saved > publishedMs;
    }).length;

    return {
        versionTag: latest.versionTag,
        publishedAt: latest.publishedAt,
        wordCount: latest.wordCount,
        releaseNotes: latest.releaseNotes,
        downloadUrl: latest.attachmentId ? `/api/attachments/${latest.attachmentId}/download` : null,
        editedSince,
    };
}

/**
 * "3 minutes ago", "yesterday".
 *
 * A bare ISO timestamp in a status line makes an author do arithmetic to answer
 * "did that just happen?", which is the only question they are asking.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
    const then = parseTime(iso);
    if (then === null) return "";

    const seconds = Math.round((now - then) / 1000);
    if (seconds < 0) return "just now"; // clock skew; never say "in 3 minutes"
    if (seconds < 60) return "just now";

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

    const days = Math.floor(hours / 24);
    if (days === 1) return "yesterday";
    if (days < 30) return `${days} days ago`;

    return new Date(then).toLocaleDateString();
}
