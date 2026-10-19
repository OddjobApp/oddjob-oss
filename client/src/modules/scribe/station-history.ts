/**
 * Station snapshot history that survives a reload.
 *
 * The canvas shows a "History (N)" panel with working Restore buttons, backed
 * by component state. It survives switching stations, but a reload or
 * unmounting the pod emptied it silently — and nothing told the author it was
 * ever temporary. A restore point that quietly stops existing is worse than no
 * restore point, because it is only missed at the moment it is needed.
 *
 * Kept in localStorage, which is honest about what this is: a local undo
 * history for one author on one browser, not server-side version control.
 * Publishing is what produces a durable, shareable version.
 *
 * Every access is guarded. localStorage throws outright in some contexts — a
 * private window, site data blocked, a thumbnail renderer — and losing the
 * ability to type because history could not be written would be a far worse
 * failure than losing the history.
 */

export interface StationSnapshot {
    timestamp: string;
    label: string;
    content: string;
    wordCount: number;
}

export type SnapshotsByNode = Record<number, StationSnapshot[]>;

/** Bumped if the stored shape changes, so old entries are ignored not misread. */
const KEY_PREFIX = "scribe:history:v1:";

/** Per station. Matches what the panel already kept in memory. */
export const MAX_SNAPSHOTS_PER_NODE = 10;

/**
 * Ceiling on one document's history.
 *
 * localStorage is a few megabytes for the whole origin, and a station holds
 * whole prose. Without a ceiling a long manuscript would fill the quota and
 * every subsequent write — including other features' — would start throwing.
 */
export const MAX_DOCUMENT_BYTES = 256 * 1024;

function keyFor(documentId: number): string {
    return `${KEY_PREFIX}${documentId}`;
}

/** History for a document, or empty if there is none or it cannot be read. */
export function loadHistory(documentId: number): SnapshotsByNode {
    try {
        const raw = window.localStorage.getItem(keyFor(documentId));
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

        // Anything malformed is dropped rather than surfaced: a corrupt entry
        // must not break the editor, and a half-read history is not restorable.
        const out: SnapshotsByNode = {};
        for (const [nodeId, list] of Object.entries(parsed)) {
            const id = Number(nodeId);
            if (!Number.isFinite(id) || !Array.isArray(list)) continue;
            const clean = list.filter(
                (s: any) =>
                    s &&
                    typeof s.content === "string" &&
                    typeof s.label === "string" &&
                    typeof s.timestamp === "string",
            );
            if (clean.length > 0) out[id] = clean.slice(-MAX_SNAPSHOTS_PER_NODE);
        }
        return out;
    } catch {
        return {};
    }
}

/**
 * Drop whole stations, oldest-known first, until the payload fits.
 *
 * Trimming snapshots within a station instead would leave every station with a
 * useless one-deep history. Losing the least recently touched station's history
 * entirely keeps the rest genuinely restorable.
 */
export function pruneToFit(history: SnapshotsByNode, activeNodeId?: number): SnapshotsByNode {
    let working: SnapshotsByNode = { ...history };
    const order = Object.keys(working)
        .map(Number)
        .filter((id) => id !== activeNodeId);

    while (JSON.stringify(working).length > MAX_DOCUMENT_BYTES && order.length > 0) {
        const drop = order.shift()!;
        const { [drop]: _removed, ...rest } = working;
        working = rest;
    }

    // Still too large with only the active station left: trim its snapshots,
    // newest kept, rather than storing nothing at all.
    while (JSON.stringify(working).length > MAX_DOCUMENT_BYTES && activeNodeId !== undefined) {
        const list = working[activeNodeId];
        if (!list || list.length <= 1) break;
        working = { ...working, [activeNodeId]: list.slice(1) };
    }

    return working;
}

/**
 * Persist, best effort. Returns whether it stuck, so a caller can tell the
 * author their history is memory-only rather than letting them assume
 * otherwise.
 */
export function saveHistory(
    documentId: number,
    history: SnapshotsByNode,
    activeNodeId?: number,
): boolean {
    try {
        const pruned = pruneToFit(history, activeNodeId);
        window.localStorage.setItem(keyFor(documentId), JSON.stringify(pruned));
        return true;
    } catch {
        // Quota exceeded, private window, site data blocked. The in-memory
        // history still works for this session.
        return false;
    }
}

/** Append a snapshot to a station, keeping the newest MAX_SNAPSHOTS_PER_NODE. */
export function appendSnapshot(
    history: SnapshotsByNode,
    nodeId: number,
    snapshot: StationSnapshot,
): SnapshotsByNode {
    const existing = history[nodeId] ?? [];
    // An unchanged save is not a restore point; it would push the useful ones
    // out of a ten-deep history.
    if (existing.length > 0 && existing[existing.length - 1].content === snapshot.content) {
        return history;
    }
    return {
        ...history,
        [nodeId]: [...existing, snapshot].slice(-MAX_SNAPSHOTS_PER_NODE),
    };
}

/** Forget a document's history, e.g. once it is published. */
export function clearHistory(documentId: number): void {
    try {
        window.localStorage.removeItem(keyFor(documentId));
    } catch {
        /* nothing to do; the entry is unreachable either way */
    }
}
