import { describe, it, expect, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { detectLaunchProfile, resolveNodeEntry, prepareNodeWorkspace, runNpm } from "./node-launch-profile.js";

/**
 * The runtime only knew Next. It proved a workspace was built by looking for
 * `.next/BUILD_ID`, and its recovery for a workspace that failed that check was
 * to copy the chat-assistant blueprint OVER it and build that — so a plain Node
 * service could not merely fail to start, it could be replaced. Classifying the
 * workspace first is what prevents that, which makes these tests a safety net
 * rather than a convenience.
 */

const ROOT = path.join(os.tmpdir(), `oddjob-launch-profile-${process.pid}`);

async function workspace(name: string, pkg: Record<string, any> | null, files: string[] = []) {
    const dir = path.join(ROOT, name);
    await fs.mkdir(dir, { recursive: true });
    if (pkg) await fs.writeFile(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2), "utf-8");
    for (const f of files) {
        await fs.mkdir(path.join(dir, path.dirname(f)), { recursive: true });
        await fs.writeFile(path.join(dir, f), "// test", "utf-8");
    }
    return dir;
}

describe("detectLaunchProfile", () => {
    afterAll(async () => {
        await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {});
    });

    it("classifies a Next app by its dependency, not by build output", async () => {
        const dir = await workspace("next-app", {
            dependencies: { next: "^14.0.0" },
            scripts: { start: "next start" },
        });
        expect(await detectLaunchProfile(dir)).toBe("next");
    });

    it("still classifies a Next app as next when it has no build yet", async () => {
        // A missing or half-written .next must not change how the app is
        // launched — build output is a consequence of the profile, not the
        // definition of it.
        const dir = await workspace("next-unbuilt", { devDependencies: { next: "^14.0.0" } });
        expect(await detectLaunchProfile(dir)).toBe("next");
    });

    it("classifies an Express service from the scaffold packs as node", async () => {
        const dir = await workspace("express-app", {
            type: "module",
            scripts: { dev: "tsx watch src/app.ts", build: "tsc", start: "node dist/app.js" },
            dependencies: { express: "^4.19.2" },
        });
        expect(await detectLaunchProfile(dir)).toBe("node");
    });

    it("is unknown when there is no manifest to read", async () => {
        const dir = await workspace("empty", null);
        expect(await detectLaunchProfile(dir)).toBe("unknown");
    });

    it("is unknown when nothing declares an entry point", async () => {
        const dir = await workspace("no-entry", { scripts: { test: "vitest" } });
        expect(await detectLaunchProfile(dir)).toBe("unknown");
    });
});

describe("resolveNodeEntry", () => {
    it("reads the entry out of the start script", () => {
        expect(resolveNodeEntry({ scripts: { start: "node dist/app.js" } })).toBe("dist/app.js");
    });

    it("ignores flags around the entry", () => {
        expect(resolveNodeEntry({ scripts: { start: "node --enable-source-maps dist/server.mjs" } }))
            .toBe("dist/server.mjs");
    });

    it("falls back to main", () => {
        expect(resolveNodeEntry({ main: "index.js" })).toBe("index.js");
    });

    it("returns null for a start script that is not a node invocation", () => {
        // `tsx src/app.ts` needs a loader this launcher does not provide, so
        // claiming it as an entry would spawn something that cannot run.
        expect(resolveNodeEntry({ scripts: { start: "tsx src/app.ts" } })).toBeNull();
    });
});

describe("prepareNodeWorkspace", () => {
    afterAll(async () => {
        await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {});
    });

    it("is ready without doing any work when the app is already built", async () => {
        const dir = await workspace(
            "ready-app",
            { scripts: { start: "node dist/app.js" } },
            ["node_modules/.keep", "dist/app.js"],
        );

        const result = await prepareNodeWorkspace(dir, "ready-app");
        expect(result.ready).toBe(true);
        expect(result.entry).toBe("dist/app.js");
    });

    it("refuses a workspace with no manifest instead of scaffolding over it", async () => {
        const dir = await workspace("no-manifest", null);
        const result = await prepareNodeWorkspace(dir, "no-manifest");

        expect(result.ready).toBe(false);
        expect(result.error).toMatch(/no package\.json/i);
    });

    it("explains what is missing when no entry point is declared", async () => {
        const dir = await workspace("undeclared", { scripts: { test: "vitest" } }, ["node_modules/.keep"]);
        const result = await prepareNodeWorkspace(dir, "undeclared");

        expect(result.ready).toBe(false);
        expect(result.error).toMatch(/no Node entry point/i);
    });

    it("reports a missing build output rather than starting a file that is not there", async () => {
        const dir = await workspace(
            "unbuilt-no-script",
            { scripts: { start: "node dist/app.js" } },
            ["node_modules/.keep"],
        );

        const result = await prepareNodeWorkspace(dir, "unbuilt-no-script");
        expect(result.ready).toBe(false);
        expect(result.error).toMatch(/declares no build script/i);
    });
});

/**
 * The npm spawn itself.
 *
 * Every guard-path test above passed while `runNpm` was incapable of running:
 * since Node 18.20/20.12, spawning a `.cmd` without a shell throws EINVAL, so
 * `execFile("npm.cmd", …)` failed on Windows for every install — a defect an
 * end-to-end run surfaced and unit tests could not, because none of them ever
 * reached npm. This one does, cheaply.
 */
describe("runNpm", () => {
    it("can actually spawn npm on this platform", async () => {
        await expect(runNpm(["--version"], os.tmpdir(), 60_000)).resolves.toBeUndefined();
    });

    it("rejects, rather than hanging, when npm fails", async () => {
        await expect(runNpm(["run", "a-script-that-does-not-exist"], os.tmpdir(), 60_000)).rejects.toThrow();
    });
});
