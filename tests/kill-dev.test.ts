import { describe, it, expect } from "vitest";
// @ts-expect-error — plain .mjs dev script, no type declarations
import { parseKillDevArgs, isDevSweepTarget, WORKER_GUARD, SCRIPT_NAME_MARKER } from "../scripts/kill-dev.core.mjs";

// Importing kill-dev.mjs must NOT free ports / kill processes: the side-effecting
// run is guarded behind isMainModule(), and under vitest process.argv[1] is the
// test runner, not kill-dev.mjs. If this import ever starts spawning netstat/pkill,
// that guard has regressed.

describe("parseKillDevArgs", () => {
    it("defaults to port 5000 with no keepPid when given no args", () => {
        const { ports, keepPid } = parseKillDevArgs([]);
        expect(ports).toEqual([5000]);
        expect(Number.isNaN(keepPid)).toBe(true);
    });

    it("parses multiple positional ports", () => {
        expect(parseKillDevArgs(["5000", "10001"]).ports).toEqual([5000, 10001]);
    });

    it("extracts --keep-pid and keeps it out of the ports list", () => {
        const { ports, keepPid } = parseKillDevArgs(["5000", "--keep-pid=1234"]);
        expect(ports).toEqual([5000]);
        expect(keepPid).toBe(1234);
    });

    it("falls back to the default port when only a flag is given", () => {
        const { ports, keepPid } = parseKillDevArgs(["--keep-pid=99"]);
        expect(ports).toEqual([5000]);
        expect(keepPid).toBe(99);
    });

    it("treats a malformed --keep-pid as absent (NaN, never a real pid)", () => {
        expect(Number.isNaN(parseKillDevArgs(["--keep-pid=abc"]).keepPid)).toBe(true);
    });

    it("ignores unknown -- flags without swallowing ports", () => {
        expect(parseKillDevArgs(["--foo", "7000"]).ports).toEqual([7000]);
    });
});

describe("isDevSweepTarget", () => {
    const marker = "Oddjob";

    it("matches the robust-dev watcher by script name even without the project path", () => {
        // The whole point of the #6 fix: robust-dev's cmdline is a RELATIVE path.
        expect(isDevSweepTarget({ commandLine: "node scripts/robust-dev.mjs", pid: 1 }, { marker })).toBe(true);
    });

    it("matches a project-scoped dev server (tsx index.ts)", () => {
        const cmd = "node C:/Users/x/Projects/Oddjob/node_modules/tsx/dist/cli.mjs server/index.ts";
        expect(isDevSweepTarget({ commandLine: cmd, pid: 2 }, { marker })).toBe(true);
    });

    it("never sweeps the worker fleet (worker-entrypoint)", () => {
        const cmd = "node C:/Users/x/Projects/Oddjob/node_modules/tsx/dist/cli.mjs server/worker-entrypoint.ts";
        expect(isDevSweepTarget({ commandLine: cmd, pid: 3 }, { marker })).toBe(false);
    });

    it("never sweeps `npm run start:worker`", () => {
        expect(isDevSweepTarget({ commandLine: "npm-cli.js run start:worker", pid: 4 }, { marker })).toBe(false);
    });

    it("excludes the invoking watcher via keepPid (no self-kill)", () => {
        const proc = { commandLine: "node scripts/robust-dev.mjs", pid: 30904 };
        expect(isDevSweepTarget(proc, { marker, keepPid: 30904 })).toBe(false); // itself
        expect(isDevSweepTarget(proc, { marker, keepPid: 111 })).toBe(true); // a different watcher
    });

    it("does not touch an unrelated node process outside the project", () => {
        expect(isDevSweepTarget({ commandLine: "node C:/tools/some-mcp-server.js", pid: 5 }, { marker })).toBe(false);
    });

    it("does not sweep the concurrently launcher, whose args include start:worker", () => {
        // Observed live: `concurrently \"npm run dev:server\" \"npm run start:worker\"` — the
        // worker guard wins, so the launcher survives (its server child is caught instead).
        const cmd = "node C:/Users/x/Projects/Oddjob/node_modules/concurrently/dist/bin/concurrently.js npm run dev:server npm run start:worker";
        expect(isDevSweepTarget({ commandLine: cmd, pid: 6 }, { marker })).toBe(false);
    });

    it("returns false for an empty/missing command line", () => {
        expect(isDevSweepTarget({ commandLine: "", pid: 7 }, { marker })).toBe(false);
        expect(isDevSweepTarget({}, { marker })).toBe(false);
    });

    it("keeps the marker constants in sync with the tested rules", () => {
        expect(WORKER_GUARD).toContain("worker-entrypoint");
        expect(WORKER_GUARD).toContain("start:worker");
        expect(SCRIPT_NAME_MARKER).toContain("robust-dev");
    });
});
