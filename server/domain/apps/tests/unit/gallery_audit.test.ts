import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

let workspace = "";
vi.mock("@domain/apps/core/forge-paths.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@domain/apps/core/forge-paths.js")>();
    return { ...actual, resolveForgeWorkspacePath: async () => workspace };
});

import { auditWorkspaceGallery, describeGalleryAudit } from "@domain/apps/core/gallery-audit.service.js";

const RAW = `export default function Page() {
  return <div><button onClick={go}>Save</button><input value={x}/></div>;
}`;

const GALLERY = `import { Button } from "@/components/ui/button";
export default function Page() {
  return <div className="bg-background"><Button onClick={go}>Save</Button></div>;
}`;

async function write(rel: string, content: string) {
    const full = path.join(workspace, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf-8");
}

beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "gallery-audit-"));
});

afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
});

describe("auditWorkspaceGallery", () => {
    it("counts the UI files that sit outside the gallery", async () => {
        await write("app/page.tsx", RAW);
        await write("app/clean.tsx", GALLERY);

        const audit = await auditWorkspaceGallery("any-slug");

        expect(audit.scanned).toBe(2);
        expect(audit.filesWithFindings).toBe(1);
        expect(audit.filesOutsideGallery).toBe(1);
        expect(audit.totalFindings).toBeGreaterThan(0);
    });

    /*
     * The walk and the scan share isGalleryScannableFile, so they cannot
     * disagree about what counts as UI. Server code, tests and the gallery's own
     * sources are not the app's interface.
     */
    it("ignores what the rule does not apply to", async () => {
        await write("server/index.ts", RAW);
        await write("app/page.test.tsx", RAW);
        await write("src/components/ui/button.tsx", RAW);
        await write("node_modules/pkg/index.tsx", RAW);
        await write(".next/build.tsx", RAW);

        const audit = await auditWorkspaceGallery("any-slug");
        expect(audit.scanned).toBe(0);
        expect(audit.filesWithFindings).toBe(0);
    });

    /*
     * The caller is reporting on a change that already happened. Throwing here
     * would lose the outcome the author is actually waiting for.
     */
    it("returns a zeroed audit rather than throwing on an unreadable workspace", async () => {
        workspace = path.join(os.tmpdir(), "definitely-not-here-" + Date.now());
        const audit = await auditWorkspaceGallery("any-slug");
        expect(audit).toEqual({
            scanned: 0,
            filesWithFindings: 0,
            filesOutsideGallery: 0,
            totalFindings: 0,
            truncated: false,
        });
    });
});

describe("describeGalleryAudit", () => {
    const audit = (filesWithFindings: number, scanned = 10, extra: Partial<any> = {}) => ({
        scanned,
        filesWithFindings,
        filesOutsideGallery: filesWithFindings,
        totalFindings: filesWithFindings * 2,
        truncated: false,
        ...extra,
    });

    /*
     * The whole point of measuring a baseline. Claiming an improvement without
     * one is precisely the unverified claim this module exists to replace.
     */
    it("states a delta only when there is a before to compare against", () => {
        expect(describeGalleryAudit(audit(3), audit(12))).toContain("improved");
        expect(describeGalleryAudit(audit(3), audit(12))).toContain("12 → 3");
        expect(describeGalleryAudit(audit(3))).not.toContain("→");
    });

    it("says so when a change made conformance worse", () => {
        expect(describeGalleryAudit(audit(9), audit(2))).toContain("regressed");
    });

    it("does not dress up an unchanged count as progress", () => {
        const line = describeGalleryAudit(audit(5), audit(5));
        expect(line).toContain("unchanged");
        expect(line).not.toContain("improved");
    });

    it("stays quiet when there is nothing to report", () => {
        expect(describeGalleryAudit(audit(0))).toBeNull();
        expect(describeGalleryAudit(audit(0, 0))).toBeNull();
    });

    it("reports a bounded walk as a floor, not a total", () => {
        const line = describeGalleryAudit(audit(4, 400, { truncated: true }));
        expect(line).toContain("first 400 UI files");
    });
});
