import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createLogger } from "@server/utils/logger.js";
import { tenantProcessEnv } from "@server/utils/tenant-process-env.js";

const execFileAsync = promisify(execFile);
const logger = createLogger("NodeLaunchProfile");

const PREPARE_TIMEOUT_MS = 10 * 60 * 1000;
const PREPARE_MAX_BUFFER = 50 * 1024 * 1024;

/**
 * How a workspace is built and started.
 *
 * The runtime only ever knew Next: it proved a workspace was built by looking
 * for `.next/BUILD_ID`, and launched it with `next start`. Anything else — an
 * Express service from the scaffold packs, for instance — failed that check,
 * and the recovery path copied the `chat-assistant` blueprint over the app and
 * built THAT, so a plain Node app could not merely fail to start, it could be
 * overwritten. This type is what lets the runtime tell them apart before any of
 * that happens.
 */
export type LaunchProfile = "next" | "node" | "unknown";

/** npm resolves through a shim on Windows; execFile does not consult PATHEXT. */
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

/**
 * Runs npm in a workspace.
 *
 * Windows needs `shell: true`. Since Node 18.20/20.12, spawning a `.cmd` or
 * `.bat` without a shell throws EINVAL outright — so `execFile("npm.cmd", …)`
 * fails on every install, which is exactly what an end-to-end run found after
 * the guard-path tests had all passed.
 *
 * That reintroduces a shell, so the rule is that nothing reaching this function
 * may be untrusted: `args` are compile-time constants at both call sites, and
 * the workspace path travels in `cwd`, an option rather than part of the
 * command string. Do not extend this to pass caller-supplied text.
 */
export async function runNpm(args: string[], cwd: string, timeoutMs = PREPARE_TIMEOUT_MS): Promise<void> {
    await execFileAsync(NPM, args, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: PREPARE_MAX_BUFFER,
        shell: process.platform === "win32",
        // devDependencies carry the build toolchain (typescript, and so on), and
        // npm omits them under NODE_ENV=production, which the server runs with.
        // npm runs the app's own install/build scripts: never the server's secrets.
        env: tenantProcessEnv({ NODE_ENV: "development" }),
    });
}

async function readPackageJson(workspacePath: string): Promise<Record<string, any> | null> {
    try {
        return JSON.parse(await fs.readFile(path.join(workspacePath, "package.json"), "utf-8"));
    } catch {
        return null;
    }
}

/**
 * Decides how an app should be started, from what its manifest declares.
 *
 * Presence of `next` as a dependency is the signal, not the presence of a
 * `.next` directory: build output is a consequence of the profile, and a stale
 * or half-written `.next` must not decide how the app is launched.
 */
export async function detectLaunchProfile(workspacePath: string): Promise<LaunchProfile> {
    const pkg = await readPackageJson(workspacePath);
    if (!pkg) return "unknown";

    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    if (deps.next) return "next";

    if (resolveNodeEntry(pkg)) return "node";
    return "unknown";
}

/**
 * The file a plain Node app starts.
 *
 * Read from `scripts.start` where possible, because that is the app's own
 * statement of its entry point, falling back to `main`. Only the path is taken
 * — it is spawned directly with the current Node binary rather than through a
 * shell, so nothing in the manifest can turn into a shell command.
 */
export function resolveNodeEntry(pkg: Record<string, any>): string | null {
    const start: string | undefined = pkg?.scripts?.start;
    if (typeof start === "string") {
        const match = start.match(/(?:^|\s)([\w./\\-]+\.(?:js|mjs|cjs))(?:\s|$)/);
        if (match) return match[1];
    }
    if (typeof pkg?.main === "string" && /\.(js|mjs|cjs)$/.test(pkg.main)) return pkg.main;
    return null;
}

export interface NodeWorkspaceReadiness {
    ready: boolean;
    entry?: string;
    error?: string;
}

/**
 * Installs dependencies and runs the app's build, if it needs either.
 *
 * Deliberately conservative: it does nothing when the workspace is already
 * usable, and it never deletes or replaces app files. npm is invoked through
 * `runNpm` with constant arguments; see the note there on why Windows needs a
 * shell and what must never be passed through it.
 */
export async function prepareNodeWorkspace(
    workspacePath: string,
    slug: string,
): Promise<NodeWorkspaceReadiness> {
    const pkg = await readPackageJson(workspacePath);
    if (!pkg) {
        return { ready: false, error: `No package.json in ${workspacePath} — nothing to start.` };
    }

    const entry = resolveNodeEntry(pkg);
    if (!entry) {
        return {
            ready: false,
            error: `${slug} declares no Node entry point: package.json needs a "main", or a "start" script of the form "node <file>".`,
        };
    }

    const hasNodeModules = await fs.access(path.join(workspacePath, "node_modules")).then(() => true).catch(() => false);
    if (!hasNodeModules) {
        logger.info(`[NodeLaunch] Installing dependencies for ${slug}...`);
        try {
            await runNpm(["install", "--no-audit", "--no-fund", "--legacy-peer-deps"], workspacePath);
        } catch (err: any) {
            return { ready: false, error: `npm install failed for ${slug}: ${err?.stderr || err?.message || err}` };
        }
    }

    const entryExists = await fs.access(path.join(workspacePath, entry)).then(() => true).catch(() => false);
    if (!entryExists && pkg?.scripts?.build) {
        logger.info(`[NodeLaunch] Building ${slug} (entry ${entry} not present)...`);
        try {
            await runNpm(["run", "build"], workspacePath);
        } catch (err: any) {
            return { ready: false, error: `Build failed for ${slug}: ${err?.stderr || err?.message || err}` };
        }
    }

    const builtEntryExists = await fs.access(path.join(workspacePath, entry)).then(() => true).catch(() => false);
    if (!builtEntryExists) {
        return {
            ready: false,
            error: `${slug} has no entry point at ${entry} after preparation${pkg?.scripts?.build ? " — the build produced nothing there" : " and declares no build script"}.`,
        };
    }

    return { ready: true, entry };
}
