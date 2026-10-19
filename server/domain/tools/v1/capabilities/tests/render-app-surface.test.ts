/**
 * render_app_surface canvas-mount marker.
 *
 * When the catalog resolves the target to an installed org app deployment,
 * the payload must carry studioSurface: 'cycle_canvas' plus the identifiers
 * the room's App Studio canvas selects on — the transcript iframe the client
 * would otherwise embed has no crewRoom binding, no surface-request host and
 * no mounted-app grounding. Agent deployments, explicit 'link' mode and
 * non-/app/ hrefs stay cards.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
    listTargets: vi.fn(),
    resolveTarget: vi.fn(),
}));

vi.mock("../app-forge-tools.js", () => ({
    listOrgAppTargets: h.listTargets,
    resolveOrgAppTarget: h.resolveTarget,
}));

import { RENDER_TOOLS } from "../render-tools.js";

const tool = RENDER_TOOLS.render_app_surface;
const ctx = { organizationId: 7 } as any;

const DEPLOYED = {
    slug: "wayfare-342",
    title: "Wayfare",
    href: "/app/wayfare-342",
    source: "app",
    appId: 11,
    deploymentId: 55,
    publicSlug: "wayfare-342",
};

function parse(result: string): any {
    try {
        return JSON.parse(result);
    } catch {
        return { raw: result };
    }
}

describe("render_app_surface studio mounting", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.listTargets.mockResolvedValue([DEPLOYED]);
        h.resolveTarget.mockReturnValue(DEPLOYED);
    });

    it("marks a catalog-resolved app deployment for the App Studio canvas", async () => {
        const payload = parse(await tool.execute(
            { title: "Wayfare", source: "app", mode: "embed" },
            ctx,
        ));

        expect(payload.studioSurface).toBe("cycle_canvas");
        expect(payload.publicSlug).toBe("wayfare-342");
        expect(payload.publicPath).toBe("/app/wayfare-342");
        expect(payload.appId).toBe(11);
        expect(payload.deploymentId).toBe(55);
        expect(payload.mode).toBe("embed");
    });

    it("does not mark an agent deployment", async () => {
        const agentTarget = { slug: "service-bot", title: "ServiceBot", href: "/a/service-bot", source: "agent_ai" };
        h.listTargets.mockResolvedValue([agentTarget]);
        h.resolveTarget.mockReturnValue(agentTarget);

        const payload = parse(await tool.execute(
            { title: "ServiceBot", source: "agent_ai", mode: "embed" },
            ctx,
        ));

        expect(payload.studioSurface).toBeUndefined();
        expect(payload.href).toBe("/a/service-bot");
    });

    it("respects an explicit link request", async () => {
        const payload = parse(await tool.execute(
            { title: "Wayfare", source: "app", mode: "link" },
            ctx,
        ));

        expect(payload.studioSurface).toBeUndefined();
        expect(payload.mode).toBe("link");
    });

    it("does not mark an href that lands outside /app/", async () => {
        const coreRoute = { slug: "metrics", title: "Metrics", href: "/pipeline/sessions?embed=cycle&orgId=7", source: "app", appId: 9, deploymentId: 9, publicSlug: null };
        h.listTargets.mockResolvedValue([coreRoute]);
        h.resolveTarget.mockReturnValue(coreRoute);

        const payload = parse(await tool.execute(
            { title: "Metrics", source: "app", mode: "embed" },
            ctx,
        ));

        expect(payload.studioSurface).toBeUndefined();
    });

    it("keeps the catalog refusal when nothing matches", async () => {
        h.resolveTarget.mockReturnValue(null);

        const payload = parse(await tool.execute(
            { title: "Wayfare", source: "app", mode: "embed" },
            ctx,
        ));

        expect(payload.error).toContain("No app matching");
        expect(payload.studioSurface).toBeUndefined();
    });
});
