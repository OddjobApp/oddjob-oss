import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let workspace = "";
vi.mock("@domain/apps/core/forge-paths.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@domain/apps/core/forge-paths.js")>();
    return { ...actual, resolveForgeWorkspacePath: async () => workspace };
});

import {
    captureSnapshot,
    restoreSnapshot,
    listSnapshots,
} from "@domain/apps/core/workspace-snapshot.service.js";

const write = async (rel: string, content: string) => {
    const full = path.join(workspace, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf-8");
};
const read = async (rel: string) => fs.readFile(path.join(workspace, rel), "utf-8");
const exists = async (rel: string) => fs.access(path.join(workspace, rel)).then(() => true, () => false);

beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "snap-"));
});
afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
});

describe("captureSnapshot / restoreSnapshot", () => {
    it("puts modified files back as they were", async () => {
        await write("app/page.tsx", "original");
        const snap = await captureSnapshot("any", ["app/page.tsx"], "before migration");
        expect(snap).not.toBeNull();

        await write("app/page.tsx", "rewritten");
        const result = await restoreSnapshot("any", snap!.id);

        expect(result.ok).toBe(true);
        expect(result.restored).toBe(1);
        expect(await read("app/page.tsx")).toBe("original");
    });

    /*
     * A file that did not exist is recorded as null, not skipped. Restoring has
     * to be able to DELETE what the change created, or a revert leaves behind
     * files the author never had.
     */
    it("removes a file the change created", async () => {
        const snap = await captureSnapshot("any", ["app/new.tsx"], "before migration");
        expect(snap!.files["app/new.tsx"]).toBeNull();

        await write("app/new.tsx", "created by the change");
        const result = await restoreSnapshot("any", snap!.id);

        expect(result.removed).toBe(1);
        expect(await exists("app/new.tsx")).toBe(false);
    });

    it("restores a whole migration together, not one file at a time", async () => {
        await write("a.tsx", "a1");
        await write("b.tsx", "b1");
        const snap = await captureSnapshot("any", ["a.tsx", "b.tsx"], "migration");

        await write("a.tsx", "a2");
        await write("b.tsx", "b2");
        await restoreSnapshot("any", snap!.id);

        expect(await read("a.tsx")).toBe("a1");
        expect(await read("b.tsx")).toBe("b1");
    });

    it("reports a missing snapshot rather than claiming success", async () => {
        const result = await restoreSnapshot("any", "snap-does-not-exist");
        expect(result.ok).toBe(false);
        expect(result.error).toContain("No such snapshot");
    });

    it("captures nothing when asked for nothing", async () => {
        expect(await captureSnapshot("any", [], "noop")).toBeNull();
    });

    /*
     * A snapshot walks paths it was handed. Escaping the workspace would let a
     * crafted path read whatever the process can read.
     */
    it("refuses a path outside the workspace", async () => {
        await write("inside.tsx", "safe");
        const snap = await captureSnapshot("any", ["inside.tsx", "../../../etc/passwd"], "probe");

        expect(Object.keys(snap!.files)).toEqual(["inside.tsx"]);
    });

    it("lists what is held, newest first", async () => {
        await write("a.tsx", "a");
        const first = await captureSnapshot("any", ["a.tsx"], "first");
        await new Promise((r) => setTimeout(r, 5));
        const second = await captureSnapshot("any", ["a.tsx"], "second");

        const list = await listSnapshots("any");
        expect(list.map((s) => s.id)).toEqual([second!.id, first!.id]);
        expect(list[0].reason).toBe("second");
        expect(list[0].files).toBe(1);
    });

    it("returns an empty list for a workspace with no snapshots", async () => {
        expect(await listSnapshots("any")).toEqual([]);
    });
});
