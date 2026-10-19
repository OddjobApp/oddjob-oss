/**
 * Workspace Watcher
 *
 * Uses chokidar to watch forge workspaces for file changes and
 * re-indexes the changed workspace via codeGraphService.
 */

import chokidar, { type FSWatcher } from "chokidar";
import path from "node:path";
import { createLogger } from "@server/utils/logger.js";
import { codeGraphService } from "../core/code-graph.service.js";
import { FORGE_WORKSPACE_ROOT } from "@domain/apps/core/forge-paths.js";

const logger = createLogger("WorkspaceWatcher");
// Canonical resolver honours $FORGE_WORKSPACE and falls back per-platform.
const FORGE_WORKSPACE = FORGE_WORKSPACE_ROOT;

// Debounce map: slug → timeout
const debounceMap = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 1500;

let watcher: FSWatcher | null = null;

// ─── Repo watcher ─────────────────────────────────────────────────────────────

/**
 * Watching the Oddjob tree is opt-in via $XRAY_WATCH_REPO. It is genuinely
 * useful in a long-running dev process but adds thousands of inotify handles,
 * so it must not switch itself on in CI or in short-lived scripts.
 */
const REPO_WATCH_ENABLED = process.env.XRAY_WATCH_REPO === "true";
const REPO_ROOT = path.resolve(process.cwd());
const REPO_SOURCE_ROOTS = ["server", "shared", "client", "scripts"];
const REPO_DEBOUNCE_MS = 3000;

let repoWatcher: FSWatcher | null = null;
let repoDebounce: NodeJS.Timeout | null = null;
// Files changed since the last flush — only these get re-parsed.
const pendingRepoFiles = new Set<string>();

export const workspaceWatcher = {
    start(): void {
        if (watcher) return;

        watcher = chokidar.watch(FORGE_WORKSPACE, {
            ignored: /(node_modules|\.next|dist|\.git)/,
            persistent: true,
            ignoreInitial: true,
            depth: 8,
        });

        watcher.on("change", (filePath) => handleChange(filePath));
        watcher.on("add", (filePath) => handleChange(filePath));
        watcher.on("error", (err) => logger.error(`[WorkspaceWatcher] ${err}`));

        logger.info(`[WorkspaceWatcher] Watching ${FORGE_WORKSPACE}`);

        this.startRepoWatch();
    },

    /**
     * Watch the Oddjob source tree and incrementally re-index changed files.
     * No-op unless $XRAY_WATCH_REPO=true.
     */
    startRepoWatch(): void {
        if (!REPO_WATCH_ENABLED || repoWatcher) return;

        repoWatcher = chokidar.watch(
            REPO_SOURCE_ROOTS.map(r => path.join(REPO_ROOT, r)),
            {
                ignored: /(node_modules|\.next|dist|\.git|coverage|\.d\.ts$)/,
                persistent: true,
                ignoreInitial: true,
                depth: 12,
            },
        );

        repoWatcher.on("change", (filePath) => handleRepoChange(filePath));
        repoWatcher.on("add", (filePath) => handleRepoChange(filePath));
        repoWatcher.on("unlink", (filePath) => handleRepoChange(filePath));
        repoWatcher.on("error", (err) => logger.error(`[RepoWatcher] ${err}`));

        logger.info(`[RepoWatcher] Watching ${REPO_SOURCE_ROOTS.join(", ")} under ${REPO_ROOT}`);
    },

    stop(): void {
        watcher?.close();
        watcher = null;
        repoWatcher?.close();
        repoWatcher = null;
        if (repoDebounce) {
            clearTimeout(repoDebounce);
            repoDebounce = null;
        }
        pendingRepoFiles.clear();
        logger.info("[WorkspaceWatcher] Stopped");
    },

    /**
     * Manually trigger re-index for a slug (called after forgeApp() completes).
     */
    async triggerIndex(slug: string): Promise<void> {
        await codeGraphService.indexWorkspace(slug);
    },
};

/**
 * Accumulate changed repo files and flush them as one incremental batch.
 *
 * A batch is used rather than a per-file re-index because a branch switch or a
 * formatter run touches hundreds of files at once, and each flush pays one
 * lookup of the stored content hashes.
 */
function handleRepoChange(filePath: string): void {
    if (!/\.(ts|tsx|js|jsx)$/.test(filePath)) return;
    if (filePath.endsWith(".d.ts")) return;

    pendingRepoFiles.add(filePath);

    if (repoDebounce) clearTimeout(repoDebounce);
    repoDebounce = setTimeout(async () => {
        repoDebounce = null;
        const files = [...pendingRepoFiles];
        pendingRepoFiles.clear();
        if (files.length === 0) return;

        logger.info(`[RepoWatcher] Re-indexing ${files.length} changed file(s)`);
        await codeGraphService.indexRepo({ repoRoot: REPO_ROOT, files }).catch(err =>
            logger.error(`[RepoWatcher] Incremental index failed: ${err.message}`)
        );
    }, REPO_DEBOUNCE_MS);
}

function handleChange(filePath: string): void {
    if (!/\.(ts|tsx|js|jsx)$/.test(filePath)) return;

    // Derive slug from path: FORGE_WORKSPACE/{slug}/...
    const rel = path.relative(FORGE_WORKSPACE, filePath);
    const slug = rel.split(path.sep)[0];
    if (!slug) return;

    // Debounce per slug: many simultaneous file saves → single re-index
    const existing = debounceMap.get(slug);
    if (existing) clearTimeout(existing);

    debounceMap.set(slug, setTimeout(async () => {
        debounceMap.delete(slug);
        logger.info(`[WorkspaceWatcher] Re-indexing ${slug} after file change`);
        await codeGraphService.indexWorkspace(slug).catch(err =>
            logger.error(`[WorkspaceWatcher] Re-index failed for ${slug}: ${err.message}`)
        );
        // Invalidate composition cache so next request gets a fresh graph
        import("../core/xray-indexing.service.js")
            .then(({ invalidateCompositionCache }) => invalidateCompositionCache(slug))
            .catch(() => {});
        // Notify downstream listeners (e.g., prefetch manifest invalidation)
        import("../core/xray-event-bus.js")
            .then(({ xrayEventBus, XrayEventType }) => {
                xrayEventBus.emitEvent({ type: XrayEventType.WORKSPACE_INVALIDATED, orgId: null, metadata: { slug } });
            })
            .catch(() => {});
    }, DEBOUNCE_MS));
}
