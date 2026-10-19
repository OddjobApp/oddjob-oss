import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("WorkspaceSnapshot");

/**
 * A restorable copy of the files a change is about to touch.
 *
 * Distinct from the builder's `.builder-last-backup.json`, which is written by
 * enhanceApp for its own undo and overwritten by the next edit. A migration
 * rewrites many files at once and the author is entitled to get all of them
 * back together, so a snapshot is taken deliberately, named, and kept until it
 * is dropped.
 *
 * Only the files named are captured. Snapshotting a whole workspace would mean
 * copying node_modules and a build directory to guard an edit to four files.
 */

const SNAPSHOT_DIR = ".forge-snapshots";
const MAX_FILES = 400;
const MAX_FILE_BYTES = 512 * 1024;

export interface WorkspaceSnapshot {
    id: string;
    slug: string;
    capturedAt: string;
    /** Relative path → contents, or null when the file did not exist. */
    files: Record<string, string | null>;
    reason: string;
}

async function snapshotPath(slug: string, id: string): Promise<string> {
    const path = await import("node:path");
    const { resolveForgeWorkspacePath } = await import("./forge-paths.js");
    return path.join(await resolveForgeWorkspacePath(slug), SNAPSHOT_DIR, `${id}.json`);
}

/**
 * Capture the current contents of `files`.
 *
 * A file that does not exist is recorded as null rather than skipped: restoring
 * has to be able to DELETE something the change created, or a revert leaves
 * behind files the author never had.
 */
export async function captureSnapshot(
    slug: string,
    files: string[],
    reason: string,
): Promise<WorkspaceSnapshot | null> {
    if (files.length === 0) return null;
    if (files.length > MAX_FILES) {
        logger.warn(`[Snapshot] Refusing to snapshot ${files.length} files for ${slug}; limit is ${MAX_FILES}.`);
        return null;
    }

    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { resolveForgeWorkspacePath, isWithinDirectory } = await import("./forge-paths.js");

    let root: string;
    try {
        root = await resolveForgeWorkspacePath(slug);
    } catch {
        return null;
    }

    const captured: Record<string, string | null> = {};
    for (const rel of files) {
        const full = path.resolve(root, rel);
        // A snapshot walks paths it was handed. Escaping the workspace would let
        // a crafted path read anything the process can read.
        if (!isWithinDirectory(root, full)) {
            logger.warn(`[Snapshot] Skipping path outside the workspace: ${rel}`);
            continue;
        }
        try {
            const stat = await fs.stat(full);
            if (stat.size > MAX_FILE_BYTES) continue;
            captured[rel] = await fs.readFile(full, "utf-8");
        } catch {
            captured[rel] = null; // Did not exist; restoring should remove it.
        }
    }

    if (Object.keys(captured).length === 0) return null;

    const snapshot: WorkspaceSnapshot = {
        id: `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        slug,
        capturedAt: new Date().toISOString(),
        files: captured,
        reason,
    };

    try {
        const target = await snapshotPath(slug, snapshot.id);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, JSON.stringify(snapshot), "utf-8");
    } catch (err: any) {
        // A snapshot that cannot be persisted is not a snapshot. Say so, so the
        // caller can decide whether to proceed without one.
        logger.error(`[Snapshot] Could not persist snapshot for ${slug}: ${err?.message ?? err}`);
        return null;
    }

    return snapshot;
}

/**
 * Read a snapshot back.
 *
 * Exposed because applying a migration has to compare what is on disk against
 * what the author actually reviewed, and the snapshot is that record.
 */
export async function readSnapshot(slug: string, id: string): Promise<WorkspaceSnapshot | null> {
    const fs = await import("node:fs/promises");
    try {
        return JSON.parse(await fs.readFile(await snapshotPath(slug, id), "utf-8"));
    } catch {
        return null;
    }
}

/** Put every captured file back, deleting the ones that did not exist. */
export async function restoreSnapshot(
    slug: string,
    id: string,
): Promise<{ restored: number; removed: number; ok: boolean; error?: string }> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { resolveForgeWorkspacePath, isWithinDirectory } = await import("./forge-paths.js");

    let snapshot: WorkspaceSnapshot;
    try {
        snapshot = JSON.parse(await fs.readFile(await snapshotPath(slug, id), "utf-8"));
    } catch {
        return { restored: 0, removed: 0, ok: false, error: "No such snapshot." };
    }

    const root = await resolveForgeWorkspacePath(slug);
    let restored = 0;
    let removed = 0;

    for (const [rel, content] of Object.entries(snapshot.files)) {
        const full = path.resolve(root, rel);
        if (!isWithinDirectory(root, full)) continue;
        try {
            if (content === null) {
                await fs.unlink(full).catch(() => {});
                removed++;
            } else {
                await fs.mkdir(path.dirname(full), { recursive: true });
                await fs.writeFile(full, content, "utf-8");
                restored++;
            }
        } catch (err: any) {
            // Keep going: a partial restore beats abandoning the rest of the
            // files because one of them is locked.
            logger.warn(`[Snapshot] Could not restore ${rel}: ${err?.message ?? err}`);
        }
    }

    return { restored, removed, ok: true };
}

/** Snapshots held for an app, newest first. */
export async function listSnapshots(slug: string): Promise<{ id: string; capturedAt: string; reason: string; files: number }[]> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { resolveForgeWorkspacePath } = await import("./forge-paths.js");

    try {
        const dir = path.join(await resolveForgeWorkspacePath(slug), SNAPSHOT_DIR);
        const entries = await fs.readdir(dir);
        const out = [];
        for (const name of entries.filter((n) => n.endsWith(".json"))) {
            try {
                const snap: WorkspaceSnapshot = JSON.parse(await fs.readFile(path.join(dir, name), "utf-8"));
                out.push({
                    id: snap.id,
                    capturedAt: snap.capturedAt,
                    reason: snap.reason,
                    files: Object.keys(snap.files).length,
                });
            } catch {
                /* an unreadable snapshot file is not worth failing the listing */
            }
        }
        return out.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    } catch {
        return [];
    }
}
