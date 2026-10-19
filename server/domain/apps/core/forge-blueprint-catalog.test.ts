/**
 * The App Forge gallery is a hardcoded catalog, and it drifted from the code twice:
 * it listed supply-chain-dispatch, which has no blueprint on disk, and it claimed
 * "MaxSMT & WCAG AA PASSED" for every entry without anything having run. These pin
 * the catalog to what exists and keep the maturity labels honest.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { forgeBlueprintService, BLUEPRINT_MATURITY } from "./forge-blueprint.service.js";

const BLUEPRINT_ROOT = path.resolve("server/blueprints/apps");
const CYCLES_ROOT = path.resolve("server/cycles");

describe("App Forge blueprint catalog", () => {
    it("lists only blueprints that exist on disk", async () => {
        const catalog = await forgeBlueprintService.listBlueprints();
        const missing = catalog.map((b) => b.slug).filter((slug) => !existsSync(path.join(BLUEPRINT_ROOT, slug)));
        expect(missing).toEqual([]);
    });

    it("gives every entry a maturity, and makes no verification claim", async () => {
        const catalog = await forgeBlueprintService.listBlueprints();
        for (const blueprint of catalog) {
            expect(["stable", "beta", "experimental"]).toContain(blueprint.maturity);
            expect(blueprint).not.toHaveProperty("formalVerification");
        }
    });

    it("labels only catalog blueprints, and only ones a cycle uses, above experimental", async () => {
        const slugs = new Set((await forgeBlueprintService.listBlueprints()).map((b) => b.slug));
        const cycles = readdirSync(CYCLES_ROOT)
            .filter((f) => f.endsWith(".cycle.yaml"))
            .map((f) => readFileSync(path.join(CYCLES_ROOT, f), "utf8"))
            .join("\n");

        for (const slug of Object.keys(BLUEPRINT_MATURITY)) {
            expect(slugs.has(slug), `${slug} is labelled but not in the catalog`).toBe(true);
            // beta and stable both rest on a cycle using the app (blueprint: or an app id).
            const usedByCycle = new RegExp(`(blueprint|id):\\s*["']?${slug}["']?\\s*$`, "m").test(cycles);
            expect(usedByCycle, `${slug} is labelled ${BLUEPRINT_MATURITY[slug]} but no cycle uses it`).toBe(true);
        }
    });
});
