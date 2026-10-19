/**
 * Capability facts extraction — the fingerprint contract.
 *
 * The thing worth testing here is not "does it produce markdown" but "does it
 * produce the SAME markdown from the same facts". The capability spec's
 * freshness (and therefore every change-register entry it creates) is decided by
 * hashing this output, so any non-determinism — map iteration order, filesystem
 * read order, an unsorted array — shows up as a spec that is permanently
 * "outdated" and a register full of phantom changes.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
    scanCapabilityFacts,
    buildCapabilityReferenceMarkdown,
    type AgentToolLike,
    type McpToolFact,
} from "./capability-facts.js";

const TOOLS: Record<string, AgentToolLike> = {
    // Approval lives in the nested `approvalPolicy`, matching ToolDefinition.
    // A flat `requiresApproval` here would reproduce the bug this shape guards.
    zeta_tool: {
        name: "zeta_tool",
        label: "Zeta",
        group: "Mission Control",
        riskLevel: "high",
        approvalPolicy: { requiresApproval: true, rationale: "Writes to a customer system." },
    },
    alpha_tool: { name: "alpha_tool", label: "Alpha", group: "Mission Control", riskLevel: "high" },
    orphan_tool: { name: "orphan_tool", label: "Orphan" },
    knowledge_tool: { name: "knowledge_tool", label: "Knowledge", group: "Knowledge Management", riskLevel: "low" },
};

const MCP_TOOLS: McpToolFact[] = [
    { name: "list_missions", description: "", sourceFile: "missions.ts" },
    { name: "create_mission", description: "", sourceFile: "missions.ts" },
    { name: "get_governor_policy", description: "", sourceFile: "governor.ts" },
];

const BLUEPRINTS = [
    { slug: "zeta-app", name: "Zeta App", description: "Z", category: "Analytics", capabilities: ["Charts", "Alerts"] },
    { slug: "alpha-app", name: "Alpha App", description: "A", category: "Communication", capabilities: [] },
    { slug: "mid-app", name: "Mid App", description: "M", category: "Analytics" },
];

function scan(overrides: Partial<Parameters<typeof scanCapabilityFacts>[0]> = {}) {
    return scanCapabilityFacts({
        mcpTools: MCP_TOOLS,
        loadAgentTools: async () => TOOLS,
        loadBlueprints: async () => BLUEPRINTS,
        goldenPathDir: path.join(process.cwd(), "fixtures", "golden-path"),
        // Point drift at an empty tree so these tests exercise the catalog, not
        // the repo's real blueprint sources (covered in blueprint-drift.test.ts).
        blueprintRoot: path.join(process.cwd(), "does-not-exist-blueprint-root"),
        ...overrides,
    });
}

function fingerprint(markdown: string): string {
    return createHash("sha256").update(markdown).digest("hex");
}

describe("capability facts extraction", () => {
    it("publishes the collaboration guide and invalidates the fingerprint when a handoff changes", async () => {
        const first = await scan({ loadCrewWorkflowGuide: async () => "## CREW handoffs\nEmail → Calendar" });
        const next = await scan({ loadCrewWorkflowGuide: async () => "## CREW handoffs\nEmail → Calendar → confirmation" });
        expect(buildCapabilityReferenceMarkdown(first)).toContain("Email → Calendar");
        expect(fingerprint(buildCapabilityReferenceMarkdown(first)))
            .not.toBe(fingerprint(buildCapabilityReferenceMarkdown(next)));
    });

    it("includes every studio and distinguishes implemented bridges from composed workflows", async () => {
        const { STUDIOS } = await import("@shared/studio-registry.js");
        const facts = await scan();
        for (const studio of Object.values(STUDIOS)) expect(facts.crewWorkflowGuide).toContain(studio.name);
        expect(facts.crewWorkflowGuide).toContain("**Implemented bridge**");
        expect(facts.crewWorkflowGuide).toContain("**Composed workflow**");
    });

    it("produces an identical fingerprint across repeated scans", async () => {
        const first = await scan();
        const second = await scan();

        expect(fingerprint(buildCapabilityReferenceMarkdown(first)))
            .toBe(fingerprint(buildCapabilityReferenceMarkdown(second)));
    });

    it("is insensitive to the insertion order of the tool registry and MCP tool list", async () => {
        const reversedTools = Object.fromEntries(Object.entries(TOOLS).reverse());
        const baseline = await scan();
        const shuffled = await scan({
            loadAgentTools: async () => reversedTools,
            mcpTools: [...MCP_TOOLS].reverse(),
        });

        expect(buildCapabilityReferenceMarkdown(shuffled))
            .toBe(buildCapabilityReferenceMarkdown(baseline));
    });

    it("changes the fingerprint when a tool is actually added", async () => {
        const before = await scan();
        const after = await scan({
            loadAgentTools: async () => ({
                ...TOOLS,
                new_tool: { name: "new_tool", label: "New", group: "Mission Control" },
            }),
        });

        expect(fingerprint(buildCapabilityReferenceMarkdown(after)))
            .not.toBe(fingerprint(buildCapabilityReferenceMarkdown(before)));
    });

    it("groups tools, counts approval gates, and buckets ungrouped tools", async () => {
        const facts = await scan();

        expect(facts.toolGroups.map((g) => g.group)).toEqual(["Knowledge Management", "Mission Control", "Ungrouped"]);
        expect(facts.totalAgentTools).toBe(4);
        expect(facts.totalApprovalGatedTools).toBe(1);
        expect(facts.totalHighRiskTools).toBe(2);

        const missionControl = facts.toolGroups.find((g) => g.group === "Mission Control")!;
        expect(missionControl.approvalGatedCount).toBe(1);
        expect(missionControl.highRiskCount).toBe(2);
        // Sorted, not registry order.
        expect(missionControl.tools.map((t) => t.name)).toEqual(["alpha_tool", "zeta_tool"]);
    });

    // Regression: the approval flag is nested under `approvalPolicy` on
    // ToolDefinition. Reading a flat `requiresApproval` compiles fine against a
    // structural type and silently reports ZERO approval-gated tools across the
    // entire registry — a governance number that is wrong in the dangerous
    // direction.
    it("reads the approval gate from approvalPolicy, not a flat field", async () => {
        const facts = await scan();
        const zeta = facts.toolGroups
            .flatMap((g) => g.tools)
            .find((t) => t.name === "zeta_tool")!;

        expect(zeta.requiresApproval).toBe(true);
        expect(zeta.approvalRationale).toBe("Writes to a customer system.");

        // A tool carrying only a flat field must NOT count as gated.
        const flatOnly = await scan({
            loadAgentTools: async () => ({
                sneaky: { name: "sneaky", label: "Sneaky", group: "Mission Control", requiresApproval: true } as AgentToolLike,
            }),
        });
        expect(flatOnly.totalApprovalGatedTools).toBe(0);
    });

    it("maps product capabilities onto their executable ACDD contracts", async () => {
        const facts = await scan();
        const durableMissions = facts.capabilities.find((c) => c.id === "durable-missions");

        expect(durableMissions).toBeDefined();
        expect(durableMissions!.contract?.capabilityId).toBe("durable_missions");
        expect(durableMissions!.contract?.riskProfile).toBe("High");
        expect(durableMissions!.evidence.hasExecutableContract).toBe(true);
        // Contract inputs are emitted as sorted name/type pairs, not a raw record.
        expect(durableMissions!.contract!.inputs.map((i) => i.name))
            .toEqual([...durableMissions!.contract!.inputs.map((i) => i.name)].sort());
    });

    it("reports evidence level without claiming anything was executed", async () => {
        const facts = await scan();

        for (const capability of facts.capabilities) {
            if (!capability.evidence.hasExecutableContract) {
                expect(capability.evidence.verificationLevel).toBe("declared");
            } else if (capability.evidence.demoIds.length > 0) {
                expect(capability.evidence.verificationLevel).toBe("contract+demo");
            } else {
                expect(capability.evidence.verificationLevel).toBe("contract");
            }
        }

        expect(facts.counts.withExecutableContract).toBeGreaterThan(0);
        expect(facts.counts.withExecutableContract).toBeLessThanOrEqual(facts.counts.capabilities);
    });

    it("carries the explicit not-positioned-as list into the facts", async () => {
        const facts = await scan();

        expect(facts.positioning.notPositionedAs.length).toBeGreaterThan(0);
        expect(buildCapabilityReferenceMarkdown(facts)).toContain("### What Oddjob is not");
    });

    it("reads golden-path fixtures in filename order and tolerates a missing directory", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "capfacts-"));
        try {
            await writeFile(path.join(dir, "b-second.json"), JSON.stringify({ id: "second", title: "Second", buyerQuestion: "Q2", successCriteria: ["x"] }));
            await writeFile(path.join(dir, "a-first.json"), JSON.stringify({ id: "first", title: "First", buyerQuestion: "Q1", successCriteria: ["y", "z"] }));
            await writeFile(path.join(dir, "broken.json"), "{ not json");

            const facts = await scan({ goldenPathDir: dir });
            // Sorted by filename, and the unparseable fixture is skipped rather
            // than failing the whole catalog.
            expect(facts.goldenPaths.map((g) => g.id)).toEqual(["first", "second"]);
            expect(facts.goldenPaths[0].successCriteria).toHaveLength(2);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }

        const missing = await scan({ goldenPathDir: path.join(tmpdir(), "capfacts-does-not-exist") });
        expect(missing.goldenPaths).toEqual([]);
    });

    it("escapes pipes so a value cannot break a markdown table row", async () => {
        const facts = await scan({
            loadAgentTools: async () => ({
                piped: { name: "piped", label: "A | B", group: "Mission Control" },
            }),
        });

        const markdown = buildCapabilityReferenceMarkdown(facts);
        expect(markdown).toContain("A \\| B");
    });

    // The default loader is the one path every other test stubs out. If the
    // registry import or the `toolRegistry.getAllTools()` call breaks, the spec
    // silently loses its entire tool inventory — and the fingerprint would still
    // look perfectly stable while doing so.
    it("loads the real static tool registry and blueprint registry through the default loaders", async () => {
        const facts = await scanCapabilityFacts({ mcpTools: MCP_TOOLS });

        expect(facts.totalAgentTools).toBeGreaterThan(100);
        expect(facts.counts.toolGroups).toBeGreaterThan(10);
        expect(facts.toolGroups.map((g) => g.group)).toContain("Mission Control");
        // System blueprints only — the default loader passes no org id, so no
        // tenant's cloned apps can leak into the platform fingerprint.
        expect(facts.counts.blueprints).toBeGreaterThan(0);
        expect(facts.blueprints.every((b) => !b.name.includes("(Clone)"))).toBe(true);

        // Regression: launch tools register from a floating promise in the tool
        // barrel, so a scan taken too early sees a short registry and the
        // fingerprint changes for no real reason. The loader must wait them out.
        expect(facts.toolGroups.some((g) => g.group === "product-launch")).toBe(true);
        // Deterministic across two independent scans of the real registry.
        expect(buildCapabilityReferenceMarkdown(facts))
            .toBe(buildCapabilityReferenceMarkdown(await scanCapabilityFacts({ mcpTools: MCP_TOOLS })));
    }, 120_000);

    it("indexes system blueprints as the fourth inventory layer", async () => {
        const facts = await scan();

        // Sorted by slug, not registry insertion order.
        expect(facts.blueprints.map((b) => b.slug)).toEqual(["alpha-app", "mid-app", "zeta-app"]);
        expect(facts.counts.blueprints).toBe(3);
        expect(facts.blueprintCategories).toEqual([
            { category: "Analytics", blueprintCount: 2 },
            { category: "Communication", blueprintCount: 1 },
        ]);

        const zeta = facts.blueprints.find((b) => b.slug === "zeta-app")!;
        expect(zeta.capabilities).toEqual(["Alerts", "Charts"]);
        // A blueprint with no declared capabilities is still catalogued.
        expect(facts.blueprints.find((b) => b.slug === "alpha-app")!.capabilities).toEqual([]);

        const markdown = buildCapabilityReferenceMarkdown(facts);
        expect(markdown).toContain("### App blueprints");
        expect(markdown).toContain("_none declared_");
    });

    it("folds blueprint drift into the fingerprinted reference", async () => {
        const facts = await scan();

        // Empty tree → every declared blueprint reports as unimplemented.
        expect(facts.blueprintDrift.counts.missingImplementation).toBe(3);
        const markdown = buildCapabilityReferenceMarkdown(facts);
        expect(markdown).toContain("### Blueprint capability drift (declared vs implemented)");
        expect(markdown).toContain("Declared but not implemented:");
    });

    it("re-fingerprints when a blueprint is added", async () => {
        const before = await scan();
        const after = await scan({
            loadBlueprints: async () => [
                ...BLUEPRINTS,
                { slug: "new-app", name: "New App", description: "N", category: "Ops", capabilities: ["X"] },
            ],
        });

        expect(fingerprint(buildCapabilityReferenceMarkdown(after)))
            .not.toBe(fingerprint(buildCapabilityReferenceMarkdown(before)));
    });

    it("emits every documented section of the reference", async () => {
        const markdown = buildCapabilityReferenceMarkdown(await scan());

        for (const heading of [
            "## Reference — platform capability catalog",
            "### Pillars",
            "### Capability matrix",
            "### Agent tool inventory",
            "### MCP tool surface",
            "### Copilot operating guide",
        ]) {
            expect(markdown).toContain(heading);
        }
    });
});
