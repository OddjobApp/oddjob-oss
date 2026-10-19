import { forgeValidatorService, isGalleryScannableFile, type SecurityIssue } from "./forge-validator.service.js";
import { resolveForgeWorkspacePath } from "./forge-paths.js";

/**
 * Component Gallery conformance, measured against an app's real workspace.
 *
 * The validator could always answer "does this file use the gallery?", but only
 * for files handed to it during a forge run. Nothing ever asked the question of
 * an app that already exists — so a restyle could be requested, the instruction
 * dutifully passed to the generator, and no one ever checked whether the
 * generator did it. Telling an author their app was migrated is a claim, and
 * this is what turns it into a measurement.
 */

/** Directories that are never the app's own source. */
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".git", ".turbo", ".cache", "build", "coverage"]);

/** Bounds, so an audit of a large workspace stays a step in a change rather than a job of its own. */
const MAX_FILES = 400;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_DEPTH = 12;

export interface GalleryAudit {
    /** UI files the rule applies to. */
    scanned: number;
    /** How many of those carry at least one finding. */
    filesWithFindings: number;
    /** Files that import no gallery component at all — the finding that matters most. */
    filesOutsideGallery: number;
    totalFindings: number;
    /** True when the walk hit its bounds, so the numbers are a floor rather than a total. */
    truncated: boolean;
}

const EMPTY: GalleryAudit = {
    scanned: 0,
    filesWithFindings: 0,
    filesOutsideGallery: 0,
    totalFindings: 0,
    truncated: false,
};

/**
 * Walk an app's workspace and measure gallery conformance.
 *
 * Never throws. A workspace that cannot be read yields a zeroed audit, because
 * the caller is reporting on a change that already happened — failing the whole
 * report over an unreadable directory would lose the outcome the author is
 * actually waiting for.
 */
export async function auditWorkspaceGallery(slug: string): Promise<GalleryAudit> {
    let fs: typeof import("node:fs/promises");
    let path: typeof import("node:path");
    try {
        fs = await import("node:fs/promises");
        path = await import("node:path");
    } catch {
        return EMPTY;
    }

    let root: string;
    try {
        root = await resolveForgeWorkspacePath(slug);
        await fs.access(root);
    } catch {
        return EMPTY;
    }

    const audit: GalleryAudit = { ...EMPTY };

    const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
        if (audit.scanned >= MAX_FILES || depth > MAX_DEPTH) {
            audit.truncated = audit.truncated || audit.scanned >= MAX_FILES;
            return;
        }

        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (audit.scanned >= MAX_FILES) {
                audit.truncated = true;
                return;
            }
            if (entry.name.startsWith(".") && entry.name !== ".") continue;
            if (SKIP_DIRS.has(entry.name)) continue;

            const full = path.join(dir, entry.name);
            const relPath = rel ? `${rel}/${entry.name}` : entry.name;

            if (entry.isDirectory()) {
                await walk(full, relPath, depth + 1);
                continue;
            }

            // The scannable test owns which files the rule applies to, so the
            // walk and the scan cannot disagree about what counts as UI.
            if (!isGalleryScannableFile(relPath)) continue;

            let content: string;
            try {
                const stat = await fs.stat(full);
                if (stat.size > MAX_FILE_BYTES) continue;
                content = await fs.readFile(full, "utf-8");
            } catch {
                continue;
            }

            audit.scanned++;
            const issues: SecurityIssue[] = forgeValidatorService.scanGalleryConformance(relPath, content);
            if (issues.length === 0) continue;

            audit.filesWithFindings++;
            audit.totalFindings += issues.length;
            if (issues.some((i) => i.message.includes("assembled without any"))) {
                audit.filesOutsideGallery++;
            }
        }
    };

    await walk(root, "", 0);
    return audit;
}

/**
 * One line an author can act on, or null when there is nothing worth saying.
 *
 * A delta is only stated when there is a `before` to compare against — claiming
 * an improvement without having measured the starting point is the exact thing
 * this module exists to stop.
 */
export function describeGalleryAudit(after: GalleryAudit, before?: GalleryAudit | null): string | null {
    if (after.scanned === 0) return null;

    const suffix = after.truncated ? ` (first ${after.scanned} UI files)` : "";

    if (before) {
        if (before.filesWithFindings === after.filesWithFindings) {
            return after.filesWithFindings === 0
                ? `Gallery conformance: still clean across ${after.scanned} UI files${suffix}.`
                : `Gallery conformance unchanged: ${after.filesWithFindings} of ${after.scanned} UI files still sit outside the gallery${suffix}.`;
        }
        const direction = after.filesWithFindings < before.filesWithFindings ? "improved" : "regressed";
        return (
            `Gallery conformance ${direction}: ${before.filesWithFindings} → ${after.filesWithFindings} ` +
            `of ${after.scanned} UI files with findings${suffix}.`
        );
    }

    if (after.filesWithFindings === 0) return null;
    return (
        `Gallery conformance: ${after.filesWithFindings} of ${after.scanned} UI files have findings` +
        `${after.filesOutsideGallery > 0 ? `, ${after.filesOutsideGallery} using no gallery components at all` : ""}${suffix}.`
    );
}
