/**
 * The live-assembly preview model.
 *
 * The value of this service is a negative guarantee: it must never name a block
 * the app cannot actually render. Everything it emits is streamed to the forge
 * progress modal as the composition being built, so a module that does not exist
 * in block-registry.json would show the user a component they will never get.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { getPackagedBlockManifest } = vi.hoisted(() => ({
    getPackagedBlockManifest: vi.fn(),
}));

vi.mock("./ui-registry.service.js", () => ({
    uiRegistryService: { getPackagedBlockManifest },
}));

const { forgeLiveAssemblyService } = await import("./forge-live-assembly.service.js");

const entry = (id: string) => ({
    id,
    name: id,
    description: `Block ${id}`,
    importPath: `@domain-ui/packaged/${id}`,
    category: "packaged",
    props: {},
    selfWires: [],
    tags: [],
});

const baseOptions: any = { name: "Test App", slug: "test-app", description: "" };

describe("forgeLiveAssemblyService.plan", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getPackagedBlockManifest.mockResolvedValue([
            entry("IndustrialDashboardHero"),
            entry("MetricGrid"),
            entry("StatusTimeline"),
            entry("MissionControlTable"),
            entry("AIAgentChat"),
        ]);
    });

    it("drops any module the registry does not actually carry", async () => {
        // The registry is the authority. If a composition names a block that has
        // been renamed or removed, the preview must shrink rather than advertise it.
        getPackagedBlockManifest.mockResolvedValue([entry("MetricGrid")]);

        const assembly = await forgeLiveAssemblyService.plan("analytics-dashboard", baseOptions);

        expect(assembly.blocks.map(b => b.module)).toEqual(["MetricGrid"]);
    });

    it("picks a composition from the blueprint and description", async () => {
        const assembly = await forgeLiveAssemblyService.plan("support-chat", baseOptions);

        expect(assembly.blocks.map(b => b.module)).toEqual([
            "AIAgentChat", "StatusTimeline", "MetricGrid",
        ]);
        expect(assembly.phase).toBe("planning");
        expect(assembly.source).toBe("component-gallery");
        expect(assembly.api.openapi).toBe("3.1.0");
        expect(assembly.api.endpoints).toHaveLength(5);
        expect(assembly.api.document.paths[`/api/test-app/test-app`]).toHaveProperty("get");
        expect(assembly.api.document.paths[`/api/test-app/test-app`]).toHaveProperty("post");
    });

    it("falls back to a dashboard composition when nothing matches", async () => {
        const assembly = await forgeLiveAssemblyService.plan("unrecognised-thing", baseOptions);

        expect(assembly.blocks.map(b => b.module)).toEqual([
            "IndustrialDashboardHero", "MetricGrid", "StatusTimeline",
        ]);
    });

    it("prefers the architecture proposal's own platform blocks", async () => {
        const proposal: any = {
            components: [
                { platformBlockId: "MissionControlTable" },
                { platformBlockId: "MetricGrid" },
            ],
        };

        const assembly = await forgeLiveAssemblyService.plan("support-chat", baseOptions, proposal);

        expect(assembly.blocks.map(b => b.module)).toEqual(["MissionControlTable", "MetricGrid"]);
    });

    it("ignores proposal components that name generated, non-gallery code", async () => {
        // architecturePhase mostly names components it intends to generate. Those
        // are not renderable blocks, so the preview must fall back to the keyword
        // composition rather than emit a block the gallery has never heard of.
        const proposal: any = {
            components: [{ platformBlockId: "CustomInvoiceWidget" }, { name: "NoBlockId" }],
        };

        const assembly = await forgeLiveAssemblyService.plan("support-chat", baseOptions, proposal);

        expect(assembly.blocks.map(b => b.module)).toEqual([
            "AIAgentChat", "StatusTimeline", "MetricGrid",
        ]);
    });

    it("does not repeat a module named twice by the proposal", async () => {
        const proposal: any = {
            components: [{ platformBlockId: "MetricGrid" }, { platformBlockId: "MetricGrid" }],
        };

        const assembly = await forgeLiveAssemblyService.plan("support-chat", baseOptions, proposal);

        expect(assembly.blocks.map(b => b.module)).toEqual(["MetricGrid"]);
    });
});

describe("forgeLiveAssemblyService API contract claims", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getPackagedBlockManifest.mockResolvedValue([entry("MetricGrid")]);
    });

    it("declares no auth at all when no assembly plan established any", async () => {
        // Not 'bearer'. With no plan we know nothing about the app's auth, and
        // advertising protection that may not exist is the wrong way to be wrong.
        const assembly = await forgeLiveAssemblyService.plan("crud-app", baseOptions);

        expect(assembly.api.endpoints.every(e => e.auth === "public")).toBe(true);
        expect(assembly.api.document.components.securitySchemes).toEqual({});
        const op = assembly.api.document.paths[`/api/test-app/test-app`].get;
        expect(op.security).toEqual([]);
    });

    it("declares bearer only when the auth pack was actually selected", async () => {
        const options: any = {
            ...baseOptions,
            assemblyPlan: { requestedPacks: ["auth-jwt"], selectedPacks: ["auth-jwt"], executionOrder: [], proofExplanation: "" },
        };

        const assembly = await forgeLiveAssemblyService.plan("crud-app", options);

        expect(assembly.api.endpoints.every(e => e.auth === "bearer")).toBe(true);
        expect(assembly.api.document.components.securitySchemes).toHaveProperty("bearerAuth");
    });

    it("falls back to session when a plan exists but selected no auth pack", async () => {
        const options: any = {
            ...baseOptions,
            assemblyPlan: { requestedPacks: ["ui-kit"], selectedPacks: ["ui-kit"], executionOrder: [], proofExplanation: "" },
        };

        const assembly = await forgeLiveAssemblyService.plan("crud-app", options);

        expect(assembly.api.endpoints.every(e => e.auth === "session")).toBe(true);
        // A session endpoint must not claim a bearer scheme it does not use.
        expect(assembly.api.document.paths[`/api/test-app/test-app`].get.security).toEqual([]);
    });

    it("never calls the contract itself certified", async () => {
        // The SAT solve resolves scaffold packs. It does not inspect this
        // contract, so the certification line must not imply that it did.
        const options: any = {
            ...baseOptions,
            assemblyPlan: { requestedPacks: ["a", "b"], selectedPacks: ["a"], executionOrder: [], proofExplanation: "" },
        };

        const withPlan = await forgeLiveAssemblyService.plan("crud-app", options);
        const withoutPlan = await forgeLiveAssemblyService.plan("crud-app", baseOptions);

        expect(withPlan.api.certification).toContain("unverified");
        expect(withPlan.api.certification).toContain("1 of 2");
        expect(withoutPlan.api.certification).toContain("unverified");
    });
});

describe("forgeLiveAssemblyService transitions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getPackagedBlockManifest.mockResolvedValue([entry("MetricGrid"), entry("StatusTimeline")]);
    });

    it("moves every block and the phase together", async () => {
        const planned = await forgeLiveAssemblyService.plan("analytics", baseOptions);

        const mounted = forgeLiveAssemblyService.withStatus(planned, "mounted", "preview");

        expect(mounted.phase).toBe("preview");
        expect(mounted.blocks.every(b => b.status === "mounted")).toBe(true);
        // The planned model is left intact — the orchestrator reassigns rather than
        // mutating, and each emit must carry its own snapshot.
        expect(planned.blocks.every(b => b.status === "selected")).toBe(true);
    });

    it("accumulates files across tasks without duplicating them", async () => {
        const planned = await forgeLiveAssemblyService.plan("analytics", baseOptions);

        const first = forgeLiveAssemblyService.withFiles(planned, ["b.tsx", "a.tsx"], "Task one");
        const second = forgeLiveAssemblyService.withFiles(first, ["a.tsx", "c.tsx"], "Task two");

        expect(second.files).toEqual(["a.tsx", "b.tsx", "c.tsx"]);
        expect(second.activeTask).toBe("Task two");
        expect(second.phase).toBe("assembling");
    });

    it("does not count a component as an API file because its name contains 'api'", async () => {
        // The test is on path segments. A substring match treated
        // src/components/RapidList.tsx as an API implementation, because "Rapid"
        // contains "api" — and therapist, capital and apiary do too.
        const planned = await forgeLiveAssemblyService.plan("crud-app", baseOptions);

        const assembling = forgeLiveAssemblyService.withFiles(planned, [
            "src/components/RapidList.tsx", "src/lib/capital.ts",
        ], "Generate UI");

        expect(assembling.api.generatedFiles).toEqual([]);
        expect(assembling.api.endpoints.every(e => e.implementationFiles.length === 0)).toBe(true);
    });

    it("streams API implementation files into the contract", async () => {
        const planned = await forgeLiveAssemblyService.plan("crud-app", baseOptions);
        const assembling = forgeLiveAssemblyService.withFiles(planned, [
            "src/routes/records.ts", "src/components/Dashboard.tsx", "openapi.json",
        ], "Generate API routes");

        expect(assembling.api.status).toBe("generating");
        expect(assembling.api.generatedFiles).toEqual(["openapi.json", "src/routes/records.ts"]);
        expect(assembling.api.endpoints.every(endpoint => endpoint.status === "generating")).toBe(true);
    });
});
