import { describe, expect, it, vi, beforeEach } from "vitest";

const listOrgDeployments = vi.fn();
vi.mock("@domain/apps/app-registry.service.js", () => ({
    appRegistryService: {
        listOrgDeployments: (...args: unknown[]) => listOrgDeployments(...args),
    },
}));

const enhanceApp = vi.fn();
const revertLast = vi.fn();
vi.mock("@domain/apps/app-builder.service.js", () => ({
    appBuilderService: {
        enhanceApp: (...args: unknown[]) => enhanceApp(...args),
        revertLast: (...args: unknown[]) => revertLast(...args),
    },
}));

import { APP_FORGE_TOOLS } from "@domain/tools/v1/capabilities/app-forge-tools.js";
import {
    detectArtifact,
    ARTIFACT_TOOLS,
    UNIVERSAL_PRESENTATION_TOOLS,
} from "@domain/crew/core/crew-tools.service.js";

const apply = APP_FORGE_TOOLS.apply_app_change;
const revert = APP_FORGE_TOOLS.revert_app_change;

const ROWS = [
    {
        deployment: { id: 9, publicSlug: "fleet-console", status: "running" },
        app: { id: 42, name: "Fleet Console", slug: "fleet-console" },
    },
];

const NO_ORG = Symbol("no org");
const run = async (tool: any, params: any, orgId: number | typeof NO_ORG = 1) =>
    tool.execute(params, orgId === NO_ORG ? {} : { organizationId: orgId });

const payload = async (tool: any, params: any) => JSON.parse((await run(tool, params)) as string);

beforeEach(() => {
    listOrgDeployments.mockReset().mockResolvedValue(ROWS);
    enhanceApp.mockReset().mockResolvedValue({ success: true, filesWritten: 3 });
    revertLast.mockReset().mockResolvedValue({ success: true, filesRestored: 3 });
});

describe("apply_app_change — outcomes are distinguished", () => {
    /*
     * enhanceApp calls all of these a success. Collapsing them into "done" is
     * how an author ends up believing an edit landed when no file was touched.
     */
    it("reports an applied change with a file count and an undo offer", async () => {
        const p = await payload(apply, { appId: 42, instruction: "add a dark mode toggle" });
        expect(p.lastChange.status).toBe("applied");
        expect(p.lastChange.filesWritten).toBe(3);
        expect(p.lastChange.canRevert).toBe(true);
        expect(p.lastChange.summary).toContain("3 file");
    });

    it("does not call a no-op an applied change", async () => {
        enhanceApp.mockResolvedValue({ success: true, filesWritten: 0 });
        const p = await payload(apply, { appId: 42, instruction: "make it better" });
        expect(p.lastChange.status).toBe("no_changes");
        expect(p.lastChange.canRevert).toBe(false);
        expect(p.lastChange.summary).toContain("Nothing was changed");
    });

    it("reports a conversational reply as an answer, not an edit", async () => {
        enhanceApp.mockResolvedValue({ success: true, conversational: true, message: "Which page did you mean?" });
        const p = await payload(apply, { appId: 42, instruction: "change the thing" });
        expect(p.lastChange.status).toBe("answered");
        expect(p.lastChange.summary).toBe("Which page did you mean?");
        expect(p.lastChange.canRevert).toBe(false);
    });

    it("reports a failed rebuild as written-but-broken, and still offers the undo", async () => {
        enhanceApp.mockResolvedValue({
            success: false, buildFailed: true, recoverable: true, backupAvailable: true,
            filesWritten: 2, error: "tsc exited 1",
        });
        const p = await payload(apply, { appId: 42, instruction: "add a page" });
        expect(p.lastChange.status).toBe("build_failed");
        expect(p.lastChange.summary).toContain("tsc exited 1");
        expect(p.lastChange.canRevert).toBe(true);
    });

    it("never offers an undo it cannot honour", async () => {
        enhanceApp.mockResolvedValue({ success: false, error: "workspace missing" });
        const p = await payload(apply, { appId: 42, instruction: "add a page" });
        expect(p.lastChange.status).toBe("failed");
        expect(p.lastChange.canRevert).toBe(false);
    });
});

describe("apply_app_change — the surface it hands back", () => {
    it("emits a studio payload the room renders, not raw JSON", async () => {
        const artifact = detectArtifact("apply_app_change", (await run(apply, {
            appId: 42, instruction: "add a page",
        })) as string);
        expect(artifact?.payload.type).toBe("app_studio_pod");
        expect((artifact?.payload as any).module).toBe("AppStudioPod");
        expect((artifact?.payload as any).mode).toBe("builder");
    });

    it("stamps each dispatch so a repeated instruction still reloads the workspace", async () => {
        const a = await payload(apply, { appId: 42, instruction: "same thing" });
        await new Promise(r => setTimeout(r, 2));
        const b = await payload(apply, { appId: 42, instruction: "same thing" });
        expect(a.lastChange.appliedAt).not.toBe(b.lastChange.appliedAt);
    });
});

describe("apply_app_change — access", () => {
    /*
     * This WRITES to a workspace and rebuilds a container. appRegistryService
     * .getApp resolves an app id across every tenant, so resolution has to go
     * through the calling org's own deployments.
     */
    it("refuses an app the organization does not have", async () => {
        const out = await run(apply, { appId: 999, instruction: "add a page" });
        expect(String(out)).toContain("not installed in this organization");
        expect(enhanceApp).not.toHaveBeenCalled();
    });

    it("refuses without an organization rather than defaulting to one", async () => {
        const out = await run(apply, { appId: 42, instruction: "add a page" }, NO_ORG);
        expect(String(out)).toContain("Organization context required");
        expect(enhanceApp).not.toHaveBeenCalled();
    });

    /*
     * The governance decision behind this slice: no agent may decide on its own
     * to rewrite an application mid-conversation. Both tools are reachable only
     * from the orchestrator's deterministic path, which first requires a studio
     * already mounted for that app plus a change intent at confidence.
     */
    it("is offered to nobody", () => {
        for (const name of ["apply_app_change", "revert_app_change"]) {
            expect(UNIVERSAL_PRESENTATION_TOOLS, `${name} must not be universal`).not.toContain(name);
            expect(ARTIFACT_TOOLS.has(name), `${name} is a write, not an artifact tool`).toBe(false);
        }
    });

    it("still renders, because detection keys off the payload type rather than the tool", async () => {
        // This is what makes the previous test safe to keep: staying out of
        // ARTIFACT_TOOLS costs the tool nothing at render time.
        const artifact = detectArtifact("apply_app_change", (await run(apply, {
            appId: 42, instruction: "add a page",
        })) as string);
        expect(artifact).not.toBeNull();
    });
});

describe("revert_app_change", () => {
    it("reports what it restored", async () => {
        const p = await payload(revert, { appId: 42 });
        expect(p.lastChange.status).toBe("reverted");
        expect(p.lastChange.summary).toContain("3 file");
    });

    it("does not offer a second undo — there is only one backup", async () => {
        const p = await payload(revert, { appId: 42 });
        expect(p.lastChange.canRevert).toBe(false);
    });

    it("reports a missing backup rather than claiming success", async () => {
        revertLast.mockResolvedValue({ success: false, error: "No backup found — nothing to revert." });
        const p = await payload(revert, { appId: 42 });
        expect(p.lastChange.status).toBe("failed");
        expect(p.lastChange.summary).toContain("No backup found");
    });

    it("is org-scoped like the change it undoes", async () => {
        const out = await run(revert, { appId: 999 });
        expect(String(out)).toContain("not installed in this organization");
        expect(revertLast).not.toHaveBeenCalled();
    });
});
