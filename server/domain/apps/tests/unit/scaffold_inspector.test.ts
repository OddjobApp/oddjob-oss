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
    inspectScaffold,
    classifyScaffold,
    type ScaffoldInspection,
} from "@domain/apps/core/scaffold-inspector.service.js";

const TOKENS = ":root{--background:0 0% 100%;--foreground:0 0% 4%;--primary:220 90% 56%;--border:0 0% 90%;}";

async function write(rel: string, content: string) {
    const full = path.join(workspace, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf-8");
}

const pkg = () => write("package.json", JSON.stringify({ dependencies: { next: "14.0.0" } }));

beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-"));
});
afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true }).catch(() => {});
});

const classify = async () => classifyScaffold(await inspectScaffold("any"));

describe("inspectScaffold", () => {
    it("reads pages, API routes, dependencies and the token contract", async () => {
        await pkg();
        await write("app/globals.css", TOKENS);
        await write("app/page.tsx", `import { Button } from "@/components/ui/button";\nexport default () => <Button/>;`);
        await write("app/api/orders/route.ts", `export function GET() {}`);

        const i = await inspectScaffold("any");

        expect(i.found).toBe(true);
        expect(i.pages).toContain("app/page.tsx");
        expect(i.apiRoutes).toContain("app/api/orders/route.ts");
        expect(i.dependencies).toContain("next");
        expect(i.hasSemanticTokens).toBe(true);
        expect(i.uiFiles[0].usesGallery).toBe(true);
    });

    it("notices an incomplete token contract rather than assuming one", async () => {
        await pkg();
        await write("app/globals.css", ":root{--background:white;}");
        await write("app/page.tsx", `import { Button } from "@/components/ui/button";\nexport default () => <Button/>;`);

        const i = await inspectScaffold("any");
        expect(i.hasGlobalStylesheet).toBe(true);
        expect(i.hasSemanticTokens).toBe(false);
    });

    it("returns not-found rather than throwing on a missing workspace", async () => {
        workspace = path.join(os.tmpdir(), "gone-" + Date.now());
        const i = await inspectScaffold("any");
        expect(i.found).toBe(false);
    });
});

describe("classifyScaffold — the five classes", () => {
    it("calls a clean gallery app gallery-native", async () => {
        await pkg();
        await write("app/globals.css", TOKENS);
        await write("app/page.tsx", `import { Button } from "@/components/ui/button";\nexport default () => <div className="bg-background"><Button/></div>;`);

        const c = await classify();
        expect(c.classification).toBe("gallery-native");
        expect(c.migratableFiles).toEqual([]);
    });

    it("calls a gallery app with a few raw controls gallery-compatible", async () => {
        await pkg();
        await write("app/globals.css", TOKENS);
        await write("app/page.tsx", `import { Button } from "@/components/ui/button";\nexport default () => <div><Button/><input value={x}/></div>;`);

        const c = await classify();
        expect(c.classification).toBe("gallery-compatible");
        expect(c.migratableFiles).toContain("app/page.tsx");
    });

    it("calls an app with no gallery imports legacy", async () => {
        await pkg();
        await write("app/page.tsx", `export default () => <div><button>Save</button><input value={x}/></div>;`);

        const c = await classify();
        expect(c.classification).toBe("legacy");
        expect(c.reasons.join(" ")).toContain("No UI file imports a gallery component");
    });

    /*
     * The distinction the migration rules turn on. Bespoke UI and un-modernised
     * markup are indistinguishable by raw-tag count, and only one of them is
     * safe to rewrite — so composing your own components is what separates them.
     */
    it("calls hand-built UI custom, and lists it as preserved rather than migratable", async () => {
        await pkg();
        const bespoke = `import { Panel } from "../components/Panel";
import { Chart } from "../components/Chart";
export default () => <Panel><Chart/><button>Go</button></Panel>;`;
        await write("app/page.tsx", bespoke);
        await write("app/dashboard.tsx", bespoke);

        const c = await classify();
        expect(c.classification).toBe("custom");
        expect(c.preserveFiles).toContain("app/page.tsx");
        expect(c.migratableFiles).not.toContain("app/page.tsx");
        expect(c.reasons.join(" ")).toContain("preserved rather than migrated");
    });

    it("calls an app that cannot start unhealthy, before considering its markup", async () => {
        // No package.json: raw controls are beside the point if it cannot run.
        await write("app/page.tsx", `export default () => <div><button>Save</button></div>;`);

        const c = await classify();
        expect(c.classification).toBe("unhealthy");
        expect(c.reasons.join(" ")).toContain("cannot install or start");
    });

    it("calls an unreadable workspace unhealthy", async () => {
        workspace = path.join(os.tmpdir(), "gone-" + Date.now());
        const c = await classify();
        expect(c.classification).toBe("unhealthy");
    });

    it("calls a workspace with no UI unhealthy rather than gallery-native", async () => {
        await pkg();
        await write("server/index.ts", `export const x = 1;`);

        const c = await classify();
        expect(c.classification).toBe("unhealthy");
    });
});

describe("classifyScaffold — what a migration is allowed to touch", () => {
    const base = (over: Partial<ScaffoldInspection> = {}): ScaffoldInspection => ({
        slug: "s",
        found: true,
        uiFiles: [],
        pages: [],
        apiRoutes: [],
        dependencies: ["next"],
        hasPackageJson: true,
        hasGlobalStylesheet: true,
        hasSemanticTokens: true,
        truncated: false,
        ...over,
    });

    const file = (path: string, over: Partial<ScaffoldInspection["uiFiles"][number]> = {}) => ({
        path,
        usesGallery: false,
        rawControls: [] as string[],
        hardcodedColour: false,
        localComponentImports: 0,
        bytes: 100,
        ...over,
    });

    /*
     * "Never silently replace unsupported custom components." That is only
     * enforceable if the preserved set is known before a patch runs, so a
     * bespoke file must never appear in migratableFiles.
     */
    it("never lists a preserved file as migratable", () => {
        const c = classifyScaffold(
            base({
                uiFiles: [
                    file("app/bespoke.tsx", { localComponentImports: 3, rawControls: ["button"] }),
                    file("app/a.tsx", { usesGallery: true, rawControls: ["input"] }),
                    file("app/b.tsx", { usesGallery: true }),
                    file("app/c.tsx", { usesGallery: true }),
                ],
            }),
        );

        expect(c.preserveFiles).toContain("app/bespoke.tsx");
        expect(c.migratableFiles).not.toContain("app/bespoke.tsx");
        expect(c.migratableFiles).toContain("app/a.tsx");
    });

    it("reports a gallery-native app as having nothing to migrate", () => {
        const c = classifyScaffold(base({ uiFiles: [file("app/a.tsx", { usesGallery: true })] }));
        expect(c.classification).toBe("gallery-native");
        expect(c.migratableFiles).toHaveLength(0);
    });

    it("still flags a hardcoded colour as migratable in an otherwise clean app", () => {
        const c = classifyScaffold(
            base({ uiFiles: [file("app/a.tsx", { usesGallery: true, hardcodedColour: true })] }),
        );
        expect(c.classification).toBe("gallery-compatible");
        expect(c.migratableFiles).toContain("app/a.tsx");
    });
});
