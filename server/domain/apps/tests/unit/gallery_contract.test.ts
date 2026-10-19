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
    validateGalleryContract,
    repairGalleryContract,
    REQUIRED_TOKENS,
} from "@domain/apps/core/gallery-contract.service.js";

const write = async (rel: string, content: string) => {
    const full = path.join(workspace, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf-8");
};
const read = async (rel: string) => fs.readFile(path.join(workspace, rel), "utf-8");

const fullTokens = `:root{\n${REQUIRED_TOKENS.map((t) => `  ${t}: 0 0% 50%;`).join("\n")}\n}`;
const check = (r: Awaited<ReturnType<typeof validateGalleryContract>>, id: string) =>
    r.checks.find((c) => c.id === id)!;

/** A workspace that satisfies the contract. */
async function healthy() {
    await write("app/globals.css", fullTokens);
    await write("app/layout.tsx", `import "./globals.css";\nexport default ({children}) => <html><body>{children}</body></html>;`);
    await write("tailwind.config.ts", `export default { content: ["./app/**/*.tsx", "./components/**/*.tsx"] };`);
}

beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "contract-"));
});
afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
});

describe("validateGalleryContract", () => {
    it("passes a workspace that satisfies the contract", async () => {
        await healthy();
        const report = await validateGalleryContract("any");
        expect(report.ok).toBe(true);
    });

    /*
     * The failure this module exists for. A missing token does not throw: the
     * class still applies, the colour resolves to nothing, and the page renders
     * unstyled while the build reports success.
     */
    it("catches an incomplete token contract", async () => {
        await healthy();
        await write("app/globals.css", ":root{ --background: 0 0% 100%; }");

        const report = await validateGalleryContract("any");
        expect(report.ok).toBe(false);
        const c = check(report, "token-contract");
        expect(c.ok).toBe(false);
        expect(c.detail).toContain("--foreground");
        expect(c.repairable).toBe(true);
    });

    it("catches an entry point that never loads the stylesheet", async () => {
        await healthy();
        await write("app/layout.tsx", `export default ({children}) => <html><body>{children}</body></html>;`);

        const report = await validateGalleryContract("any");
        expect(check(report, "global-styles-loaded").ok).toBe(false);
        expect(check(report, "global-styles-loaded").detail).toContain("no token resolves");
    });

    /*
     * Components outside Tailwind's globs have their classes stripped by the JIT
     * compiler, which looks exactly like an unstyled page.
     */
    it("catches Tailwind globs that miss the component directories", async () => {
        await healthy();
        await write("tailwind.config.ts", `export default { content: ["./app/page.tsx"] };`);

        const report = await validateGalleryContract("any");
        expect(check(report, "tailwind-content").ok).toBe(false);
    });

    it("catches a reference to a token nothing declares", async () => {
        await healthy();
        await write("app/page.tsx", `export default () => <div style={{ color: "var(--brand-special)" }}/>;`);

        const report = await validateGalleryContract("any");
        const c = check(report, "undefined-tokens");
        expect(c.ok).toBe(false);
        expect(c.detail).toContain("--brand-special");
        // Inventing a value would be a guess about what the author meant it to
        // look like.
        expect(c.repairable).toBe(false);
    });

    it("reports an unreadable workspace rather than passing it", async () => {
        workspace = path.join(os.tmpdir(), "gone-" + Date.now());
        const report = await validateGalleryContract("any");
        expect(report.ok).toBe(false);
    });
});

describe("repairGalleryContract", () => {
    it("declares the missing tokens and leaves the app valid", async () => {
        await healthy();
        await write("app/globals.css", ":root{ --background: 0 0% 100%; }");

        const result = await repairGalleryContract("any");

        expect(result.ok).toBe(true);
        expect(result.repaired.join(" ")).toContain("token");
        const css = await read("app/globals.css");
        expect(css).toContain("--foreground");
        expect(css).toContain("--radius");
    });

    /*
     * An author who set their own primary colour meant it. Repair that
     * overwrites intent is vandalism, so it only ever adds what is absent.
     */
    it("never overwrites a token the app already declares", async () => {
        await healthy();
        await write("app/globals.css", ":root{ --primary: 300 100% 50%; }");

        await repairGalleryContract("any");

        const css = await read("app/globals.css");
        expect(css).toContain("--primary: 300 100% 50%");
        expect(css.match(/--primary:/g)).toHaveLength(1);
    });

    it("imports the stylesheet from the entry point, below a use-client directive", async () => {
        await healthy();
        await write("app/layout.tsx", `"use client";\nexport default ({children}) => <body>{children}</body>;`);

        await repairGalleryContract("any");

        const entry = await read("app/layout.tsx");
        expect(entry.indexOf('"use client"')).toBe(0);
        expect(entry).toContain('import "./globals.css";');
    });

    it("extends Tailwind content globs without discarding the existing ones", async () => {
        await healthy();
        await write("tailwind.config.ts", `export default { content: ["./app/page.tsx"] };`);

        await repairGalleryContract("any");

        const config = await read("tailwind.config.ts");
        expect(config).toContain("./app/page.tsx");
        expect(config).toContain("components/**");
    });

    it("reports what it could not repair rather than claiming success", async () => {
        await healthy();
        await write("app/page.tsx", `export default () => <div style={{ color: "var(--brand-special)" }}/>;`);

        const result = await repairGalleryContract("any");

        expect(result.ok).toBe(false);
        expect(result.remaining.map((c) => c.id)).toContain("undefined-tokens");
    });

    it("re-validates after repairing, so its verdict is measured rather than assumed", async () => {
        await healthy();
        await write("app/globals.css", ":root{}");
        await write("app/layout.tsx", `export default ({children}) => <body>{children}</body>;`);

        const result = await repairGalleryContract("any");

        expect(result.repaired.length).toBeGreaterThanOrEqual(2);
        expect(result.ok).toBe(true);
        expect(result.remaining).toEqual([]);
    });
});
