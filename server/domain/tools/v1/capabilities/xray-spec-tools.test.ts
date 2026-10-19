/**
 * Keyed retrieval of X-Ray architecture specs.
 *
 * The property that matters is the one a vector search cannot provide: asked for
 * a node that has no spec, this must SAY SO. A similarity search always returns
 * its nearest neighbour and presents it as an answer, which is how a crew room
 * asking "how does Oddjob use world models?" got back "Past Mission: Research:
 * How does Oddjob use world models" — the question, restated, instead of the
 * briefing that answered it.
 *
 * The second property is that a 136KB spec must not be handed to a model whole.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let rows: any[] = [];

const selectChain = () => ({
    from: () => selectChain(),
    where: () => selectChain(),
    orderBy: () => selectChain(),
    limit: async () => rows,
});

vi.mock("@server/database_service.js", () => ({ db: { select: () => selectChain() } }));
vi.mock("@shared/schema/index.js", () => ({
    xrayNodeDocumentation: {
        organizationId: "organization_id",
        nodeId: "node_id",
        nodeType: "node_type",
        summary: "summary",
        status: "status",
        updatedAt: "updated_at",
    },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn(), or: vi.fn(), ilike: vi.fn(), desc: vi.fn() }));
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
vi.mock("../../../xray/core/xray-composition.service.js", () => ({ xrayCompositionService: {} }));

const { XRAY_TOOLS } = await import("./xray-tools.js");

const ORG = { organizationId: 291 } as any;

function spec(overrides: Record<string, any> = {}) {
    return {
        id: 13,
        nodeId: "scope::rescue-dispatch",
        nodeType: "app_architecture",
        summary: "Rescue dispatch architecture",
        status: "published",
        content: "# Application Architecture\n" + "x".repeat(50_000),
        updatedAt: new Date("2026-08-14T03:27:06.409Z"),
        ...overrides,
    };
}

beforeEach(() => { rows = []; });

describe("get_xray_spec", () => {
    it("says plainly that nothing is documented rather than returning a near match", async () => {
        rows = [];
        const out = await XRAY_TOOLS.get_xray_spec.execute({ node: "does-not-exist" }, ORG);
        expect(out).toContain("No X-Ray spec is documented");
        expect(out).toContain("do not infer the architecture from the node's name");
    });

    it("returns the spec for an exact node id", async () => {
        rows = [spec()];
        const out = await XRAY_TOOLS.get_xray_spec.execute({ node: "scope::rescue-dispatch" }, ORG);
        expect(out).toContain("X-Ray Spec: scope::rescue-dispatch (app_architecture)");
        expect(out).toContain("Rescue dispatch architecture");
    });

    it("truncates a large spec and offers the next offset", async () => {
        rows = [spec()];
        const out: string = await XRAY_TOOLS.get_xray_spec.execute({ node: "rescue-dispatch" }, ORG);
        expect(out.length).toBeLessThan(20_000);
        expect(out).toContain("offset=12000");
    });

    it("continues from an offset", async () => {
        rows = [spec()];
        const out: string = await XRAY_TOOLS.get_xray_spec.execute({ node: "rescue-dispatch", offset: 12000 }, ORG);
        expect(out).toContain("offset=24000");
    });

    it("prefers the exact id when several nodes match, and names the others", async () => {
        rows = [
            spec({ id: 9, nodeId: "scope::competitive-intelligence-strategy" }),
            spec({ id: 10, nodeId: "screen::/competitive-intelligence-strategy", nodeType: "screen" }),
        ];
        const out: string = await XRAY_TOOLS.get_xray_spec.execute(
            { node: "screen::/competitive-intelligence-strategy" },
            ORG,
        );
        expect(out).toContain("X-Ray Spec: screen::/competitive-intelligence-strategy (screen)");
        expect(out).toContain("Other nodes also matched: scope::competitive-intelligence-strategy");
    });

    it("refuses without organization context", async () => {
        const out = await XRAY_TOOLS.get_xray_spec.execute({ node: "anything" }, {} as any);
        expect(out).toContain("without organization context");
    });
});

describe("list_xray_specs", () => {
    it("reports honestly when nothing is documented", async () => {
        rows = [];
        const out = await XRAY_TOOLS.list_xray_specs.execute({}, ORG);
        expect(out).toContain("No X-Ray specs are documented");
    });

    it("returns ids and summaries, not spec bodies", async () => {
        rows = [spec()];
        const out: string = await XRAY_TOOLS.list_xray_specs.execute({}, ORG);
        const parsed = JSON.parse(out);
        expect(parsed.count).toBe(1);
        expect(parsed.specs[0].nodeId).toBe("scope::rescue-dispatch");
        expect(out).not.toContain("Application Architecture");
    });
});
