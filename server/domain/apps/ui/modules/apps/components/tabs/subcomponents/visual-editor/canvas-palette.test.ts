import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PALETTE_CATEGORIES } from "./VisualCanvasEditor.js";

/**
 * The palette hands each block id to the builder as
 * `import <id> from "@domain-ui/packaged/<id>"`, so an id with no module behind
 * it becomes an unresolvable import in the generated app. The palette shipped
 * three of those — PlatformCalendarBlock, PlatformKanbanBoardBlock and
 * PlatformWorkflowBuilderBlock — none of which exist.
 */
const PACKAGED_DIR = path.resolve("server/domain/core/ui/components/packaged");

const packagedModules = new Set(
    fs.readdirSync(PACKAGED_DIR)
        .filter((f) => f.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(f))
        .map((f) => path.basename(f, ".tsx")),
);

const paletteBlocks = PALETTE_CATEGORIES.flatMap((c) => c.blocks);

describe("visual canvas palette", () => {
    it("reads the packaged directory it is asserting against", () => {
        expect(packagedModules.size).toBeGreaterThan(20);
        expect(paletteBlocks.length).toBeGreaterThan(10);
    });

    it.each(paletteBlocks.map((b) => [b.id] as const))(
        "%s resolves to a real packaged module",
        (id) => {
            expect(packagedModules.has(id)).toBe(true);
        },
    );

    it("has no duplicate block ids across categories", () => {
        const ids = paletteBlocks.map((b) => b.id);
        expect(ids).toHaveLength(new Set(ids).size);
    });

    it("gives every block a label, category and known accent", () => {
        const accents = ["Primary", "Emerald", "Amber", "Cyan", "Rose"];
        for (const b of paletteBlocks) {
            expect(b.label, `${b.id} label`).toBeTruthy();
            expect(b.category, `${b.id} category`).toBeTruthy();
            expect(accents, `${b.id} accent`).toContain(b.accent);
        }
    });
});

describe("arsenal platform blocks", () => {
    // Same defect class as the canvas palette: the Arsenal's Platform Blocks group
    // is imported as @domain-ui/packaged/<name>, and listed three modules that do
    // not exist (PlatformKanbanBoardBlock, PlatformWorkflowBuilderBlock,
    // PlatformMetricsDashboardBlock).
    it("only lists blocks that exist on disk", async () => {
        const { UI_COMPONENT_GROUPS } = await import("../../AppInteractiveBuilderTab.js");
        const group = UI_COMPONENT_GROUPS.find((g: any) => g.label.includes("Platform Blocks"));
        expect(group, "Platform Blocks group").toBeDefined();
        const missing = group!.components.filter((name: string) => !packagedModules.has(name));
        expect(missing).toEqual([]);
    });
});

describe("block registry catalog", () => {
    // Third surface with the same defect: block-registry.json feeds the
    // app-builder catalog as @domain-ui/packaged/<id> imports, and carried eight
    // entries with no module behind them.
    const registry = JSON.parse(
        fs.readFileSync(path.resolve("server/domain/apps/core/block-registry.json"), "utf-8"),
    ) as { blocks?: Array<{ id: string; path?: string }> };
    const registryBlocks = Array.isArray(registry) ? registry : (registry.blocks ?? []);

    it("every catalog entry resolves to a real packaged module", () => {
        const missing = registryBlocks
            .filter((b) => (b.path || "").includes("@domain-ui/packaged/"))
            .filter((b) => !packagedModules.has(b.id));
        expect(missing.map((b) => b.id)).toEqual([]);
    });

    it("has no duplicate block ids", () => {
        const ids = registryBlocks.map((b) => b.id).filter(Boolean);
        const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
        expect([...new Set(dupes)]).toEqual([]);
    });
});
