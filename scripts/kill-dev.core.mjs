/**
 * Pure, side-effect-free core of kill-dev.
 *
 * Split out of kill-dev.mjs so it can be imported by tests. kill-dev.mjs carries a
 * `#!/usr/bin/env node` shebang: node imports that happily, but esbuild parses `#`
 * as an invalid token, so tests/kill-dev.test.ts failed to collect with
 * "SyntaxError: Invalid or unexpected token" and ran none of its 17 assertions.
 * This module has no shebang and no side effects.
 */

// Sweep markers — the SINGLE source of truth shared by the OS matchers (below)
// and the pure `isDevSweepTarget` predicate (used by tests). All three are
// regex fragments (note the escaped `\\.`).
// ---------------------------------------------------------------------------
//   - SCRIPT_NAME_MARKER: robust-dev is launched as `node scripts/robust-dev.mjs`
//     with a RELATIVE path, so its cmdline never contains the project dir and a
//     `*Oddjob*` path filter can NEVER catch it. That is exactly why duplicate
//     watchers survived every prior sweep and kept fighting over :5000. Match it
//     by its project-specific script name instead, independent of path scope.
export const SCRIPT_NAME_MARKER = "robust-dev\\.mjs";
//   - PATH_SCOPED_MARKERS: the concurrently launcher / dev:server / tsx index.ts
//     DO carry the project path, so they stay scoped to the project dir to remain
//     surgical (never touch another project's dev server).
export const PATH_SCOPED_MARKERS = "concurrently|dev:server|index\\.ts";
//   - WORKER_GUARD: the standalone worker fleet (`npm run start:worker` ->
//     tsx server/worker-entrypoint.ts) is a separate long-lived process and must
//     NEVER be swept — robust-dev calls freePort() on EVERY restart, and killing
//     the worker each reload made the fleet exit 127 as collateral.
export const WORKER_GUARD = "worker-entrypoint|start:worker";

/**
 * Parse kill-dev's argv (everything after `node kill-dev.mjs`).
 * `--keep-pid=<pid>` exempts one process from the sweep (robust-dev passes its
 * OWN pid so freePort() never kills the invoking watcher). Everything that is
 * not a `--flag` is treated as a port; defaults to [5000] when none are given.
 * @param {string[]} argv
 * @returns {{ ports: number[], keepPid: number }} keepPid is NaN when absent/malformed.
 */
export function parseKillDevArgs(argv) {
    const keepPidArg = argv.find((a) => a.startsWith("--keep-pid="));
    const keepPid = keepPidArg ? Number(keepPidArg.split("=")[1]) : NaN;
    const portArgs = argv.filter((a) => !a.startsWith("--"));
    const ports = (portArgs.length ? portArgs : ["5000"]).map(Number);
    return { ports, keepPid };
}

/**
 * Pure predicate mirroring the OS-level sweep matchers: should this process be
 * swept? A process is a target when it is the robust-dev watcher (by script
 * name) OR a project-scoped server runner (concurrently / dev:server / index.ts
 * whose cmdline includes the project dir marker) — but NEVER when it is the
 * worker fleet or the caller-exempted keepPid. Shares the marker constants above
 * with the real matchers so a marker change can't silently diverge from its test.
 * @param {{ commandLine?: string, pid?: number|string }} proc
 * @param {{ marker?: string, keepPid?: number }} [opts]
 * @returns {boolean}
 */
export function isDevSweepTarget({ commandLine, pid } = {}, { marker, keepPid } = {}) {
    if (!commandLine) return false;
    if (new RegExp(WORKER_GUARD).test(commandLine)) return false; // worker fleet: never
    if (Number.isFinite(keepPid) && Number(pid) === Number(keepPid)) return false; // never self-kill
    const isWatcher = new RegExp(SCRIPT_NAME_MARKER).test(commandLine);
    const isPathScopedServer =
        !!marker && commandLine.includes(marker) && new RegExp(PATH_SCOPED_MARKERS).test(commandLine);
    return isWatcher || isPathScopedServer;
}
