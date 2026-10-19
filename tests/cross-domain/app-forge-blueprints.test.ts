/**
 * App Forge — Blueprint Registry & Selection tests
 * @vitest-environment node
 *
 * Covers:
 *  - blueprintRegistryService: all 8 slugs present, required fields, no stale slugs
 *  - forgeCodegenService.selectBlueprint: keyword heuristic maps to correct slug
 *  - forge-prompts: BLUEPRINT-SPECIFIC section references all 8 slugs
 */

import { describe, it, expect } from "vitest";

// ── Blueprint registry ─────────────────────────────────────────────────────────

import { blueprintRegistryService } from "@server/domain/apps/blueprint-registry.service.js";

const EXPECTED_SLUGS = [
    "analytics-dashboard",
    "chat-assistant",
    "crud-app",
    "api",
    "spa",
    "pwa",
    "rescue-dispatch",
    "mission-supervisor",
] as const;

const DROPPED_SLUGS = [
    "crm-tracker",
    "api-monitor",
    "forensic-audit",
    "jira-issues-dashboard",
    "cart-recovery-tracker",
    "atomic-canvas",
    "copilotkit-starter",
    "knowledge-base",
];

describe("blueprintRegistryService", () => {
    it("lists at least 8 blueprints", async () => {
        const all = await blueprintRegistryService.listAll();
        expect(all.length).toBeGreaterThanOrEqual(8);
    });

    it("contains all expected slugs", async () => {
        const all = await blueprintRegistryService.listAll();
        const slugs = all.map(b => b.slug);
        for (const slug of EXPECTED_SLUGS) {
            expect(slugs).toContain(slug);
        }
    });

    it("does not contain any dropped slugs", async () => {
        const all = await blueprintRegistryService.listAll();
        const slugs = all.map(b => b.slug);
        for (const slug of DROPPED_SLUGS) {
            expect(slugs).not.toContain(slug);
        }
    });

    it("every blueprint has required fields", async () => {
        const all = await blueprintRegistryService.listAll();
        for (const bp of all) {
            expect(bp.slug,        `${bp.slug} missing slug`).toBeTruthy();
            expect(bp.name,        `${bp.slug} missing name`).toBeTruthy();
            expect(bp.description, `${bp.slug} missing description`).toBeTruthy();
            expect(bp.icon,        `${bp.slug} missing icon`).toBeTruthy();
            expect(bp.category,    `${bp.slug} missing category`).toBeTruthy();
            expect(Array.isArray(bp.capabilities), `${bp.slug} capabilities must be array`).toBe(true);
            expect(bp.capabilities.length, `${bp.slug} must have at least 1 capability`).toBeGreaterThan(0);
        }
    });

    it("get() returns correct entry for each slug", async () => {
        for (const slug of EXPECTED_SLUGS) {
            const bp = await blueprintRegistryService.get(slug);
            expect(bp).not.toBeNull();
            expect(bp!.slug).toBe(slug);
        }
    });

    it("get() returns null for a dropped slug", async () => {
        const bp = await blueprintRegistryService.get("crm-tracker");
        expect(bp).toBeNull();
    });

    it("enrich() falls back gracefully for unknown slug", async () => {
        const result = await blueprintRegistryService.enrich(["unknown-slug"]);
        expect(result).toHaveLength(1);
        expect(result[0].slug).toBe("unknown-slug");
        expect(result[0].name).toBeTruthy();
        expect(result[0].icon).toBe("Hammer");
    });

    it("enrich() uses registry data for known slugs", async () => {
        const result = await blueprintRegistryService.enrich(["analytics-dashboard", "crud-app"]);
        expect(result[0].name).toBe("Analytics Dashboard");
        expect(result[1].name).toBe("CRUD App");
    });
});

// ── Blueprint keyword selection ────────────────────────────────────────────────

import { forgeCodegenService } from "@server/domain/apps/core/forge-codegen.service.js";

describe("forgeCodegenService.selectBlueprint — keyword heuristic", () => {
    const cases: [string, string, string][] = [
        ["analytics dashboard with trend charts and kpi metrics", "spa", "analytics-dashboard"],
        ["chat assistant with conversation history and ai support bot", "spa", "chat-assistant"],
        ["crud app to manage contacts leads and deal pipeline", "spa", "crud-app"],
        ["rest api with webhook endpoint and proxy integration routes", "spa", "api"],
        ["single page app internal tool portal with sidebar navigation", "spa", "spa"],
        ["progressive web app pwa installable with offline mode", "spa", "pwa"],
        ["rescue dispatch with map location geo coordinate routing", "spa", "rescue-dispatch"],
        ["mission supervisor for pipeline automation orchestration workflow", "spa", "mission-supervisor"],
    ];

    for (const [description, defaultSlug, expectedSlug] of cases) {
        it(`"${description.slice(0, 40)}…" → "${expectedSlug}"`, async () => {
            const result = await forgeCodegenService.selectBlueprint(description, defaultSlug);
            expect(result).toBe(expectedSlug);
        });
    }

    it("falls back to defaultSlug when no keywords match", async () => {
        const result = await forgeCodegenService.selectBlueprint("a totally unrelated zebra", "spa");
        expect(result).toBe("spa");
    });

    it("does not return any dropped slug via keyword heuristic", async () => {
        const dropped = [
            "crm tracker with jira issues sprint backlog",        // old crm-tracker / jira keywords
            "knowledge base wiki documentation faq search articles", // knowledge-base
            "forensic audit security compliance investigation",    // forensic-audit
        ];
        for (const desc of dropped) {
            const result = await forgeCodegenService.selectBlueprint(desc, "spa");
            expect(DROPPED_SLUGS).not.toContain(result);
        }
    });
});

// ── Slot-Fill & Token Acceleration ───────────────────────────────────────────

describe("forgeCodegenService — Slot-Fill logic", () => {
    it("detects slots in a template string", () => {
        const template = "const title = '{{APP_TITLE}}'; const items = {{ITEMS}};";
        const snapshot = { "file.tsx": template };
        const slots = forgeCodegenService.detectSlots(snapshot);
        
        expect(slots["file.tsx"]).toContain("APP_TITLE");
        expect(slots["file.tsx"]).toContain("ITEMS");
        expect(slots["file.tsx"]).toHaveLength(2);
    });

    it("returns empty object if no slots detected", () => {
        const snapshot = { "file.tsx": "const noSlots = true;" };
        const slots = forgeCodegenService.detectSlots(snapshot);
        expect(slots).toEqual({});
    });

    it("fills slots correctly in a template", () => {
        const template = "Title: {{APP_TITLE}}, Data: {{DATA}}";
        const result = (forgeCodegenService as any).fillSlots(template, {
            "APP_TITLE": "Test App",
            "DATA": "[1, 2, 3]"
        });
        expect(result).toBe("Title: Test App, Data: [1, 2, 3]");
    });

    /**
     * Unfilled slots collapse to an empty string literal, they are not left in
     * place: fillSlots tries a defaults dictionary and then replaces whatever
     * remains with `""`, so the emitted file is still syntactically valid.
     * Keeping `{{MISSING}}` — which this asserted — would ship a template token
     * into generated TSX and break the app it was generating.
     */
    it("collapses an unfilled slot to an empty literal so the output stays valid", () => {
        const template = "Title: {{APP_TITLE}}, Data: {{MISSING}}";
        const result = (forgeCodegenService as any).fillSlots(template, {
            "APP_TITLE": "Test App"
        });
        expect(result).toBe('Title: Test App, Data: ""');
    });

    it("prefers a known default over the empty literal", () => {
        const result = (forgeCodegenService as any).fillSlots("id: {{AGENT_ID}}", {});
        expect(result).toBe("id: 1");
    });
});

// ── forge-prompts: BLUEPRINT-SPECIFIC section ─────────────────────────────────

import { FORGE_CODE_GEN_PROMPT } from "@server/domain/apps/core/forge-prompts.js";

describe("FORGE_CODE_GEN_PROMPT blueprint-specific requirements", () => {
    it("contains BLUEPRINT-SPECIFIC section", () => {
        expect(FORGE_CODE_GEN_PROMPT).toContain("BLUEPRINT-SPECIFIC REQUIREMENTS");
    });

    it("references all 8 blueprint slugs", () => {
        for (const slug of EXPECTED_SLUGS) {
            expect(FORGE_CODE_GEN_PROMPT, `Prompt missing entry for "${slug}"`).toContain(`**${slug}**`);
        }
    });

    it("does not reference any dropped slug", () => {
        for (const slug of DROPPED_SLUGS) {
            expect(FORGE_CODE_GEN_PROMPT, `Prompt still references dropped slug "${slug}"`).not.toContain(`**${slug}**`);
        }
    });

    it("references RescueMap import path", () => {
        expect(FORGE_CODE_GEN_PROMPT).toContain("@domain-ui/rescue/ui/modules/rescue/components/RescueMap");
    });

    it("references platform proxy route", () => {
        expect(FORGE_CODE_GEN_PROMPT).toContain("/api/oddjob/");
    });

    it("forbids hardcoded static data mandate", () => {
        expect(FORGE_CODE_GEN_PROMPT).toContain("NEVER return hardcoded arrays or static objects");
    });
});

import { FORGE_SLOT_FILL_PROMPT } from "@server/domain/apps/core/forge-prompts.js";

describe("FORGE_SLOT_FILL_PROMPT — Acceleration Prompt", () => {
    it("exists and is not empty", () => {
        expect(FORGE_SLOT_FILL_PROMPT).toBeTruthy();
        expect(FORGE_SLOT_FILL_PROMPT.length).toBeGreaterThan(100);
    });

    it("contains slot schema instruction", () => {
        expect(FORGE_SLOT_FILL_PROMPT).toContain("SCAFFOLD SLOTS TO FILL");
    });

    it("requires JSON output", () => {
        expect(FORGE_SLOT_FILL_PROMPT).toContain("Return ONLY a flat JSON object");
    });
});

// ── Platform SDK prompt — Tier 1 routes ───────────────────────────────────────

describe("FORGE_CODE_GEN_PROMPT Tier 1 platform routes", () => {
    it("documents POST /api/oddjob/missions for create+launch", () => {
        expect(FORGE_CODE_GEN_PROMPT).toContain("POST /api/oddjob/missions");
    });

    it("documents GET /api/oddjob/missions/{runId}/status", () => {
        expect(FORGE_CODE_GEN_PROMPT).toContain("/api/oddjob/missions/{runId}/status");
    });

    it("documents POST /api/oddjob/jobs for agent job creation", () => {
        expect(FORGE_CODE_GEN_PROMPT).toContain("POST /api/oddjob/jobs");
    });

    it("documents budget cap for mission creation", () => {
        expect(FORGE_CODE_GEN_PROMPT).toContain("server-capped at $1.00");
    });

    it("documents mission run polling pattern", () => {
        expect(FORGE_CODE_GEN_PROMPT).toContain("setInterval");
        expect(FORGE_CODE_GEN_PROMPT).toContain(`"completed"`);
        expect(FORGE_CODE_GEN_PROMPT).toContain(`"failed"`);
    });

    it("mission-supervisor blueprint mentions new routes", () => {
        const supervisorLine = FORGE_CODE_GEN_PROMPT
            .split("\n")
            .find(l => l.includes("**mission-supervisor**")) ?? "";
        expect(supervisorLine).toContain("POST /api/oddjob/missions");
        expect(supervisorLine).toContain("POST /api/oddjob/jobs");
    });
});
