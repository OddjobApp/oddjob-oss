import { describe, expect, it, vi, beforeEach } from "vitest";

const listOrgDeployments = vi.fn();
vi.mock("@domain/apps/app-registry.service.js", () => ({
    appRegistryService: {
        listOrgDeployments: (...args: unknown[]) => listOrgDeployments(...args),
    },
}));

const listDrafts = vi.fn();
vi.mock("@domain/apps/core/forge-draft.service.js", () => ({
    forgeDraftService: {
        listDrafts: (...args: unknown[]) => listDrafts(...args),
    },
}));

import { APP_FORGE_TOOLS } from "@domain/tools/v1/capabilities/app-forge-tools.js";
import { detectArtifact } from "@domain/crew/core/crew-tools.service.js";

const tool = APP_FORGE_TOOLS.mount_app_studio;

beforeEach(() => {
    listOrgDeployments.mockReset().mockResolvedValue([
        { deployment: { publicSlug: "crm-app" }, app: { id: 10, name: "CRM App", slug: "crm-app" } },
    ]);
    listDrafts.mockReset().mockResolvedValue([
        { jobId: "old-job-888", status: "running", name: "Unrelated Draft" },
    ]);
});

describe("mount_app_studio", () => {
    it("mounts in forge walkthrough mode without hijacking unrelated drafts for new app builds", async () => {
        const out = await tool.execute(
            { mode: "forge", title: "Fleet Management", requirements: "Track company trucks" } as any,
            { organizationId: 1 } as any,
        );
        const artifact = detectArtifact("mount_app_studio", out as string);

        expect(artifact?.payload.type).toBe("app_studio_pod");
        expect((artifact?.payload as any).mode).toBe("forge");
        expect((artifact?.payload as any).title).toBe("Fleet Management");
        expect((artifact?.payload as any).requirements).toBe("Track company trucks");
        // Must NOT hijack the old active draft from listDrafts
        expect((artifact?.payload as any).jobId).toBeNull();
        expect((artifact?.payload as any).props).toBeDefined();
        expect((artifact?.payload as any).props.mode).toBe("forge");
        expect((artifact?.payload as any).props.title).toBe("Fleet Management");
    });

    it("mounts in builder mode directly for existing applications", async () => {
        const out = await tool.execute(
            { mode: "builder", appId: 10 } as any,
            { organizationId: 1 } as any,
        );
        const artifact = detectArtifact("mount_app_studio", out as string);

        expect(artifact?.payload.type).toBe("app_studio_pod");
        expect((artifact?.payload as any).mode).toBe("builder");
        expect((artifact?.payload as any).appId).toBe(10);
        expect((artifact?.payload as any).appName).toBe("CRM App");
        expect((artifact?.payload as any).props).toBeDefined();
        expect((artifact?.payload as any).props.mode).toBe("builder");
        expect((artifact?.payload as any).props.appId).toBe(10);
    });

    it("attaches to an active draft only when explicitly requested or resuming without new specs", async () => {
        const out = await tool.execute(
            { mode: "forge" } as any,
            { organizationId: 1 } as any,
        );
        const artifact = detectArtifact("mount_app_studio", out as string);

        expect(artifact?.payload.type).toBe("app_studio_pod");
        expect((artifact?.payload as any).jobId).toBe("old-job-888");
    });
});
