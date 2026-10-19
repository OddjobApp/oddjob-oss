import { describe, expect, it, vi, beforeEach } from "vitest";

const listOrgDeployments = vi.fn();
vi.mock("@domain/apps/app-registry.service.js", () => ({
    appRegistryService: {
        listOrgDeployments: (...args: unknown[]) => listOrgDeployments(...args),
    },
}));

const startForgeRun = vi.fn();
vi.mock("@domain/apps/core/forge-start.service.js", async (importOriginal) => {
    // deriveForgeSlug is real: the slug the tool picks is part of what is being
    // tested, and stubbing it would make the collision test vacuous.
    const actual = await importOriginal<typeof import("@domain/apps/core/forge-start.service.js")>();
    return { ...actual, startForgeRun: (...args: unknown[]) => startForgeRun(...args) };
});

import { APP_FORGE_TOOLS } from "@domain/tools/v1/capabilities/app-forge-tools.js";
import {
    detectArtifact,
    ARTIFACT_TOOLS,
    UNIVERSAL_PRESENTATION_TOOLS,
} from "@domain/crew/core/crew-tools.service.js";

const tool = APP_FORGE_TOOLS.start_app_forge;

beforeEach(() => {
    listOrgDeployments.mockReset().mockResolvedValue([
        { deployment: { publicSlug: "fleet-console" }, app: { id: 42, name: "Fleet Console", slug: "fleet-console" } },
    ]);
    startForgeRun.mockReset().mockResolvedValue({ started: true, jobId: "job-77" });
});

describe("start_app_forge", () => {
    it("starts a run and hands back a studio attached to it", async () => {
        const out = await tool.execute(
            { name: "Warehouse Inventory", description: "track pallets in and out" } as any,
            { organizationId: 1 } as any,
        );
        const artifact = detectArtifact("start_app_forge", out as string);

        expect(artifact?.payload.type).toBe("app_studio_pod");
        expect((artifact?.payload as any).mode).toBe("forge");
        expect((artifact?.payload as any).jobId).toBe("job-77");
        expect((artifact?.payload as any).requirements).toBe("track pallets in and out");
    });

    it("derives a slug that steps around the org's existing apps", async () => {
        await tool.execute(
            { name: "Fleet Console", description: "another one" } as any,
            { organizationId: 1 } as any,
        );
        expect(startForgeRun.mock.calls[0][0].slug).toBe("fleet-console-2");
    });

    it("honours an explicit slug", async () => {
        await tool.execute(
            { name: "Anything", description: "x", slug: "chosen-slug" } as any,
            { organizationId: 1 } as any,
        );
        expect(startForgeRun.mock.calls[0][0].slug).toBe("chosen-slug");
    });

    /*
     * A refused start returns prose, not a studio. Handing back a studio here
     * would show a progress row for a build that is not running.
     */
    it("reports a run already in flight instead of pretending to start one", async () => {
        startForgeRun.mockResolvedValue({ started: false, reason: "already_running", slug: "fleet-console", existingJobId: "job-1" });
        const out = await tool.execute(
            { name: "Fleet Console", description: "x" } as any,
            { organizationId: 1 } as any,
        );
        expect(String(out)).toContain("already building");
        expect(String(out)).toContain("job-1");
        expect(detectArtifact("start_app_forge", out as string)).toBeNull();
    });

    it("refuses without an organization rather than defaulting to one", async () => {
        const out = await tool.execute({ name: "X", description: "y" } as any, {} as any);
        expect(String(out)).toContain("Organization context required");
        expect(startForgeRun).not.toHaveBeenCalled();
    });

    /*
     * Provisioning a container is the most consequential thing in this feature.
     * No agent may reach it on its own; only the orchestrator's confirmed path.
     */
    it("is offered to nobody", () => {
        expect(UNIVERSAL_PRESENTATION_TOOLS).not.toContain("start_app_forge");
        expect(ARTIFACT_TOOLS.has("start_app_forge")).toBe(false);
    });
});
