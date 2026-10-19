/**
 * Blueprint capability drift — the honesty contract.
 *
 * These tests exist to stop the check from lying in either direction: claiming a
 * capability is implemented because a marketing adjective appeared in the code,
 * or reporting drift because one did not.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { scanBlueprintDrift, capabilityTerms } from "./blueprint-drift.js";

let root: string;

beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "bp-drift-"));

    // Implements what it claims.
    await mkdir(path.join(root, "mapper", "components"), { recursive: true });
    await writeFile(
        path.join(root, "mapper", "components", "GpxExporter.tsx"),
        "export function exportGpx() { /* corridor discovery */ }",
    );
    await writeFile(path.join(root, "mapper", "package.json"), JSON.stringify({ name: "mapper" }));

    // Claims things its source knows nothing about.
    await mkdir(path.join(root, "overclaimer"), { recursive: true });
    await writeFile(path.join(root, "overclaimer", "index.tsx"), "export const Empty = () => null;");

    // Source with no registry entry.
    await mkdir(path.join(root, "orphan"), { recursive: true });
    await writeFile(path.join(root, "orphan", "index.ts"), "export const x = 1;");

    // Build output must never be mistaken for authored source.
    await mkdir(path.join(root, "overclaimer", "node_modules", "glassmorphism"), { recursive: true });
    await writeFile(
        path.join(root, "overclaimer", "node_modules", "glassmorphism", "index.js"),
        "module.exports = 'glassmorphism telemetry';",
    );

    // Shared scaffolding is not a blueprint.
    await mkdir(path.join(root, "shared"), { recursive: true });
    await writeFile(path.join(root, "shared", "util.ts"), "export const u = 1;");

    // Backend starters carry no TypeScript at all.
    await mkdir(path.join(root, "polyglot"), { recursive: true });
    await writeFile(path.join(root, "polyglot", "main.go"), 'r := gin.Default() // health status');
    await writeFile(path.join(root, "polyglot", "main.py"), 'from fastapi import FastAPI');
    await writeFile(
        path.join(root, "polyglot", "Health.java"),
        "package x; // spring boot runtime",
    );
});

afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});

const DECLARED = [
    { slug: "mapper", capabilities: ["GPX Export", "Discovery Corridor"] },
    { slug: "overclaimer", capabilities: ["Glassmorphism", "Real-time Telemetry"] },
    { slug: "ghost", capabilities: ["Anything"] },
];

describe("blueprint capability drift", () => {
    it("verifies a capability whose distinctive terms appear in source", async () => {
        const drift = await scanBlueprintDrift({ declared: DECLARED, blueprintRoot: root });
        const mapper = drift.blueprints.find((b) => b.slug === "mapper")!;

        expect(mapper.status).toBe("aligned");
        expect(mapper.capabilities.every((c) => c.status === "verified")).toBe(true);
        // Matches across identifier casing: `exportGpx` evidences "GPX Export".
        expect(mapper.capabilities.find((c) => c.capability === "GPX Export")!.evidence)
            .toContain("components/GpxExporter.tsx");
    });

    it("flags declared capabilities with no supporting code", async () => {
        const drift = await scanBlueprintDrift({ declared: DECLARED, blueprintRoot: root });
        const over = drift.blueprints.find((b) => b.slug === "overclaimer")!;

        expect(over.status).toBe("unevidenced");
        expect(over.capabilities.find((c) => c.capability === "Glassmorphism")!.status).toBe("unverified");
        expect(over.capabilities.find((c) => c.capability === "Real-time Telemetry")!.missingTerms)
            .toContain("telemetry");
    });

    it("never treats dependency or build output as evidence", async () => {
        const drift = await scanBlueprintDrift({ declared: DECLARED, blueprintRoot: root });
        const over = drift.blueprints.find((b) => b.slug === "overclaimer")!;

        // "glassmorphism" exists ONLY inside node_modules. Counting it would let
        // any blueprint prove any claim by installing a package.
        expect(over.capabilities.find((c) => c.capability === "Glassmorphism")!.matchedTerms).toEqual([]);
    });

    it("reports both drift directions and skips shared scaffolding", async () => {
        const drift = await scanBlueprintDrift({ declared: DECLARED, blueprintRoot: root });

        expect(drift.blueprints.find((b) => b.slug === "ghost")!.status).toBe("missing_implementation");
        expect(drift.blueprints.find((b) => b.slug === "orphan")!.status).toBe("undeclared");
        expect(drift.blueprints.map((b) => b.slug)).not.toContain("shared");
        // Assert on slugs, not raw counts: a count is brittle against any new
        // fixture directory added to this suite.
        expect(drift.blueprints.filter((b) => b.status === "missing_implementation").map((b) => b.slug))
            .toEqual(["ghost"]);
        expect(drift.blueprints.filter((b) => b.status === "undeclared").map((b) => b.slug))
            .toEqual(["orphan", "polyglot"]);
    });

    // Regression: requiring "ready" to appear in source made "Webhook Ready"
    // read as partially implemented even when webhooks were plainly handled.
    it("does not let a marketing qualifier block verification", async () => {
        const drift = await scanBlueprintDrift({
            declared: [{ slug: "mapper", capabilities: ["GPX Ready", "Export Mode"] }],
            blueprintRoot: root,
        });
        const mapper = drift.blueprints.find((b) => b.slug === "mapper")!;

        expect(mapper.capabilities.every((c) => c.status === "verified")).toBe(true);
        expect(mapper.capabilities.flatMap((c) => c.missingTerms)).toEqual([]);
    });

    // The inverse guard: a claim made only of generic words proves nothing, so a
    // full term match must not be promoted to "verified".
    it("never verifies a capability that has no distinctive terms", async () => {
        const drift = await scanBlueprintDrift({
            declared: [{ slug: "mapper", capabilities: ["Platform App"] }],
            blueprintRoot: root,
        });
        const capability = drift.blueprints.find((b) => b.slug === "mapper")!.capabilities[0];

        expect(capability.weakMatch).toBe(true);
        expect(capability.status).not.toBe("verified");
        expect(drift.counts.verifiedCapabilities).toBe(0);
    });

    // Regression: the extension allowlist originally covered only TS/JS, so the
    // Go, Java, and Python backend starters scanned to an EMPTY corpus and every
    // capability they declared reported as unevidenced. Drift must not depend on
    // the implementation language.
    it("scans non-JavaScript blueprints", async () => {
        const drift = await scanBlueprintDrift({
            declared: [{
                slug: "polyglot",
                capabilities: ["Gin Runtime", "FastAPI Runtime", "Spring Boot Runtime", "Health Status"],
            }],
            blueprintRoot: root,
        });
        const polyglot = drift.blueprints.find((b) => b.slug === "polyglot")!;

        expect(polyglot.sourceFileCount).toBeGreaterThan(0);
        expect(polyglot.status).toBe("aligned");
    });

    // Regression: a blueprint defining `LogBlock` for a live console was
    // reported as not implementing "Live Logs", because the literal plural never
    // appears in source. Plurality is not a semantic difference.
    it("matches singular and plural forms of a term", async () => {
        const drift = await scanBlueprintDrift({
            declared: [{ slug: "mapper", capabilities: ["GPX Exports", "Corridor Discoveries"] }],
            blueprintRoot: root,
        });
        const mapper = drift.blueprints.find((b) => b.slug === "mapper")!;

        expect(mapper.capabilities.every((c) => c.status === "verified")).toBe(true);
    });

    it("still reports a term that is absent in both forms", async () => {
        const drift = await scanBlueprintDrift({
            declared: [{ slug: "mapper", capabilities: ["Pipeline Triggers"] }],
            blueprintRoot: root,
        });
        const capability = drift.blueprints.find((b) => b.slug === "mapper")!.capabilities[0];

        expect(capability.status).toBe("unverified");
        expect(capability.missingTerms).toEqual(expect.arrayContaining(["pipeline", "triggers"]));
    });

    // Regression: a 25-line blueprint that renders one shared packaged component
    // reported every capability as unimplemented, because the implementation
    // lives outside its directory. Composition is implementation.
    it("follows a relative import that leaves the blueprint directory", async () => {
        const shared = path.join(root, "..", `bp-shared-${path.basename(root)}`);
        await mkdir(shared, { recursive: true });
        await writeFile(path.join(shared, "ChatBlock.tsx"), "export const streamingChat = () => null;");

        const thin = path.join(root, "thin");
        await mkdir(thin, { recursive: true });
        await writeFile(
            path.join(thin, "index.tsx"),
            `import { streamingChat } from '../../${path.basename(shared)}/ChatBlock';`,
        );

        try {
            const drift = await scanBlueprintDrift({
                declared: [{ slug: "thin", capabilities: ["Streaming Chat"] }],
                blueprintRoot: root,
            });
            const capability = drift.blueprints.find((b) => b.slug === "thin")!.capabilities[0];

            expect(capability.status).toBe("verified");
            // Evidence names the external file so the delegation stays visible.
            expect(capability.evidence.join(" ")).toContain("ChatBlock.tsx");
        } finally {
            await rm(shared, { recursive: true, force: true });
            await rm(thin, { recursive: true, force: true });
        }
    });

    it("is deterministic across repeated scans", async () => {
        const a = await scanBlueprintDrift({ declared: DECLARED, blueprintRoot: root });
        const b = await scanBlueprintDrift({ declared: DECLARED, blueprintRoot: root });
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it("reports registry entries as unimplemented when the tree is absent", async () => {
        const drift = await scanBlueprintDrift({
            declared: DECLARED,
            blueprintRoot: path.join(tmpdir(), "bp-drift-does-not-exist"),
        });

        expect(drift.blueprints).toHaveLength(DECLARED.length);
        expect(drift.blueprints.every((b) => b.status === "missing_implementation")).toBe(true);
    });

    it("extracts distinctive terms, dropping punctuation and short tokens", () => {
        expect(capabilityTerms("Co-Pilot Collaboration")).toEqual(["collaboration", "pilot"]);
        expect(capabilityTerms("Mach 4 Assembly")).toEqual(["assembly", "mach"]);
        expect(capabilityTerms("Search & Sort")).toEqual(["search", "sort"]);
    });
});
