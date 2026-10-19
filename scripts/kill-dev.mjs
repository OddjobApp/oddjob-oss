#!/usr/bin/env node
/**
 * kill-dev — free the dev server port(s) before (re)starting.
 *
 * Windows does not propagate termination to grandchild processes, so Ctrl+C on
 * `npm run dev` (npm -> concurrently -> npm -> tsx -> node) routinely orphans the
 * tsx/node server + worker. The orphan keeps LISTENING on the port, so the next
 * `npm run dev` dies with EADDRINUSE and you end up serving a stale zombie
 * (see the "Failed to fetch dynamically imported module" / null.useEffect symptoms).
 *
 * This is deliberately PORT-BASED and surgical: it only kills the process tree
 * that is currently listening on the target port(s), plus a narrow sweep of the
 * project's own dev runners. It never blanket-kills node, so it won't touch your
 * editor, Claude Code, Playwright, or MCP servers.
 *
 * Usage:
 *   node scripts/kill-dev.mjs                       # frees 5000 (dev server)
 *   node scripts/kill-dev.mjs 5000 10001            # frees additional ports (forged apps)
 *   node scripts/kill-dev.mjs 5000 --keep-pid=1234  # sweep, but never touch pid 1234
 *
 * Recommended: wire as a predev hook so it runs automatically:
 *   "predev": "node scripts/kill-dev.mjs"
 *
 * The pure decision helpers (parseKillDevArgs, isDevSweepTarget) and the marker
 * constants are exported so they can be unit-tested without spawning OS commands;
 * see tests/kill-dev.test.ts. The side-effecting run only happens when this file
 * is executed directly (see isMainModule), never on import.
 */
import { execSync } from "node:child_process";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const isWindows = os.platform() === "win32";

// ---------------------------------------------------------------------------
// The pure matchers/parsers live in kill-dev.core.mjs (no shebang) so tests can
// import them; re-exported here so this file's public surface is unchanged.
export {
    SCRIPT_NAME_MARKER,
    PATH_SCOPED_MARKERS,
    WORKER_GUARD,
    parseKillDevArgs,
    isDevSweepTarget,
} from "./kill-dev.core.mjs";
import {
    SCRIPT_NAME_MARKER,
    PATH_SCOPED_MARKERS,
    WORKER_GUARD,
    parseKillDevArgs,
    isDevSweepTarget,
} from "./kill-dev.core.mjs";

function pidsOnPort(port) {
    const pids = new Set();
    try {
        if (isWindows) {
            const out = execSync("netstat -ano -p tcp", { encoding: "utf8" });
            for (const line of out.split("\n")) {
                // e.g.  TCP    0.0.0.0:5000    0.0.0.0:0    LISTENING    41920
                const m = line.match(/:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
                if (m && Number(m[1]) === port) pids.add(m[2]);
            }
        } else {
            const out = execSync(`lsof -ti tcp:${port} -s tcp:LISTEN`, { encoding: "utf8" });
            for (const pid of out.split("\n")) if (pid.trim()) pids.add(pid.trim());
        }
    } catch {
        // netstat/lsof found nothing (non-zero exit) — treat as empty.
    }
    return [...pids];
}

function killTree(pid) {
    try {
        if (isWindows) execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
        else execSync(`kill -9 ${pid}`, { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

/**
 * Sweep lingering Oddjob dev processes that the port-based kill misses: the
 * robust-dev watcher (matched by script name) and the concurrently / dev:server
 * / tsx index.ts runners (path-scoped). The worker fleet and `keepPid` are always
 * excluded (see the marker constants). Best-effort — never blocks a restart.
 * @param {number} [keepPid] process to exempt (NaN/undefined = exempt nothing).
 */
function sweepOddjobDevProcesses(keepPid) {
    const marker = path.basename(process.cwd()); // e.g. "Oddjob"
    try {
        if (isWindows) {
            // (robust-dev.mjs  OR  Oddjob-path + server marker)  AND NOT worker fleet
            // AND NOT the invoking watcher (keepPid), so freePort() never self-kills.
            const match = `( $_.CommandLine -match '${SCRIPT_NAME_MARKER}' -or ( $_.CommandLine -like '*${marker}*' -and $_.CommandLine -match '${PATH_SCOPED_MARKERS}' ) )`;
            const keepGuard = Number.isFinite(keepPid) ? ` -and $_.ProcessId -ne ${keepPid}` : "";
            const ps = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and ${match} -and $_.CommandLine -notmatch '${WORKER_GUARD}'${keepGuard} } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; $_.ProcessId } catch {} }`;
            const out = execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, { encoding: "utf8" });
            const n = out.split("\n").filter((l) => l.trim()).length;
            if (n) console.log(`[kill-dev] swept ${n} lingering server dev process(es)`);
        } else {
            // robust-dev by script name (no path in its cmdline); worker-entrypoint is
            // never matched (it carries neither robust-dev.mjs nor the server markers).
            // pkill has no portable exclude, so loop over pgrep and skip keepPid to
            // avoid self-killing the invoking watcher. A POSIX `for` loop (not
            // `xargs -r`, which is GNU-only) keeps this portable to BSD/macOS and
            // no-ops cleanly when pgrep finds nothing. Empty keep => matches no pid,
            // so every match is killed. Default SIGTERM lets the process shut down.
            const keep = Number.isFinite(keepPid) ? keepPid : "";
            try {
                execSync(`for pid in $(pgrep -f '${SCRIPT_NAME_MARKER}'); do [ "$pid" != "${keep}" ] && kill "$pid"; done`, { stdio: "ignore" });
            } catch { /* nothing matched */ }
            try {
                execSync(`pkill -f '${marker}.*(${PATH_SCOPED_MARKERS})'`, { stdio: "ignore" });
            } catch { /* pkill exits non-zero when nothing matched */ }
        }
    } catch {
        // best-effort — never block a restart on cleanup
    }
}

/** Free the requested ports (by listener tree) then sweep sibling dev runners. */
function main(argv) {
    const { ports, keepPid } = parseKillDevArgs(argv);
    let killedAny = false;
    for (const port of ports) {
        const pids = pidsOnPort(port);
        if (pids.length === 0) {
            console.log(`[kill-dev] port ${port}: nothing listening`);
            continue;
        }
        for (const pid of pids) {
            const ok = killTree(pid);
            console.log(`[kill-dev] port ${port}: ${ok ? "killed" : "failed to kill"} pid ${pid}${isWindows ? " (+tree)" : ""}`);
            killedAny = killedAny || ok;
        }
    }
    // Also sweep the sibling worker + orphaned dev processes the port-based kill misses.
    sweepOddjobDevProcesses(keepPid);
    if (killedAny) console.log("[kill-dev] done — port(s) freed.");
}

/** True only when this file is the process entry point (not when imported by a test). */
function isMainModule() {
    try {
        return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
}

if (isMainModule()) main(process.argv.slice(2));
