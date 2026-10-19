import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let workspace = "";
vi.mock("@domain/apps/core/forge-paths.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@domain/apps/core/forge-paths.js")>();
    return { ...actual, resolveForgeWorkspacePath: async () => workspace };
});

import { applyGalleryMigration, verifyMigration } from "@domain/apps/core/gallery-migration.service.js";
import { captureSnapshot, restoreSnapshot } from "@domain/apps/core/workspace-snapshot.service.js";

const RAW = `export default function Page() {
  return <div><button onClick={go}>Save</button></div>;
}`;

const write = async (rel: string, content: string) => {
    const full = path.join(workspace, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf-8");
};
const read = async (rel: string) => fs.readFile(path.join(workspace, rel), "utf-8");

beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "migrate-"));
});
afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
});

describe("applyGalleryMigration", () => {
    it("writes the migration the author reviewed", async () => {
        await write("app/page.tsx", RAW);
        const snap = await captureSnapshot("any", ["app/page.tsx"], "before");

        const result = await applyGalleryMigration("any", snap!.files);

        expect(result.applied).toEqual(["app/page.tsx"]);
        const after = await read("app/page.tsx");
        expect(after).toContain("<Button onClick={go}>Save</Button>");
        expect(after).toContain('import { Button } from "@/components/ui/button";');
    });

    /*
     * The snapshot is the record of what was reviewed. If a file moved after the
     * proposal was rendered, the approved diff no longer describes it — so it is
     * skipped rather than overwritten with a rewrite of something the author
     * never saw.
     */
    it("refuses to write over a file that changed since the proposal", async () => {
        await write("app/page.tsx", RAW);
        const snap = await captureSnapshot("any", ["app/page.tsx"], "before");

        await write("app/page.tsx", `${RAW}\n// someone edited this in the meantime`);
        const result = await applyGalleryMigration("any", snap!.files);

        expect(result.stale).toEqual(["app/page.tsx"]);
        expect(result.applied).toEqual([]);
        expect(await read("app/page.tsx")).toContain("in the meantime");
    });

    it("applies the files that are still current and reports the ones that are not", async () => {
        await write("a.tsx", RAW);
        await write("b.tsx", RAW);
        const snap = await captureSnapshot("any", ["a.tsx", "b.tsx"], "before");

        await write("b.tsx", `${RAW}\n// moved`);
        const result = await applyGalleryMigration("any", snap!.files);

        expect(result.applied).toEqual(["a.tsx"]);
        expect(result.stale).toEqual(["b.tsx"]);
    });

    it("skips a file with nothing left to map", async () => {
        await write("a.tsx", `import { Button } from "@/components/ui/button";\nexport default () => <Button/>;`);
        const snap = await captureSnapshot("any", ["a.tsx"], "before");

        const result = await applyGalleryMigration("any", snap!.files);
        expect(result.applied).toEqual([]);
        expect(result.stale).toEqual([]);
    });
});

describe("verifyMigration", () => {
    it("passes a clean migration", async () => {
        await write("app/page.tsx", `import { Button } from "@/components/ui/button";\nexport default () => <Button/>;`);
        const v = await verifyMigration("any", ["app/page.tsx"]);
        expect(v.ok).toBe(true);
        expect(v.blocking).toEqual([]);
    });

    /*
     * A styling pass has no business introducing a security finding, so that is
     * blocking — but remaining gallery findings are not. The mapper deliberately
     * leaves select and table alone, so findings afterwards are the expected
     * outcome rather than a failure.
     */
    it("does not fail a migration for gallery findings it deliberately left behind", async () => {
        await write("app/page.tsx", `import { Button } from "@/components/ui/button";
export default () => <div><Button/><select><option>a</option></select></div>;`);

        const v = await verifyMigration("any", ["app/page.tsx"]);
        expect(v.ok).toBe(true);
        expect(v.filesWithFindings).toBeGreaterThan(0);
    });

    it("fails a migration that introduced a security finding", async () => {
        await write("app/page.tsx", `export default () => { eval(userInput); return null; };`);
        const v = await verifyMigration("any", ["app/page.tsx"]);

        expect(v.ok).toBe(false);
        expect(v.blocking.join(" ")).toMatch(/eval/i);
    });

    it("fails when a written file cannot be read back", async () => {
        const v = await verifyMigration("any", ["app/never-written.tsx"]);
        expect(v.ok).toBe(false);
        expect(v.blocking.join(" ")).toContain("could not be read back");
    });
});

describe("apply then roll back", () => {
    /*
     * A partial migration is the worst outcome available: half the app moved and
     * the author cannot tell which half. A failed verification restores
     * everything the snapshot covers, not just the file that failed.
     */
    it("restores every file the snapshot covers, not just the failing one", async () => {
        await write("a.tsx", RAW);
        await write("b.tsx", RAW);
        const snap = await captureSnapshot("any", ["a.tsx", "b.tsx"], "before");

        await applyGalleryMigration("any", snap!.files);
        expect(await read("a.tsx")).toContain("<Button");
        expect(await read("b.tsx")).toContain("<Button");

        await restoreSnapshot("any", snap!.id);

        expect(await read("a.tsx")).toBe(RAW);
        expect(await read("b.tsx")).toBe(RAW);
    });

    it("leaves the migration reversible after a successful apply", async () => {
        await write("a.tsx", RAW);
        const snap = await captureSnapshot("any", ["a.tsx"], "before");
        await applyGalleryMigration("any", snap!.files);

        const result = await restoreSnapshot("any", snap!.id);
        expect(result.ok).toBe(true);
        expect(await read("a.tsx")).toBe(RAW);
    });
});
