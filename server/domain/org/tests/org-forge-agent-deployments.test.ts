/**
 * Unit tests for OrgForgeService.provisionAgentDeployments — the step that
 * makes `agents[].publish_as_public_agent` real by upserting an
 * agentDeployments row and building its form manifest + fallback routes
 * (upsert → updateManifest → derive, matching the deploy route).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
    getBySlug: vi.fn(),
    getByJobId: vi.fn(),
    upsert: vi.fn(),
    updateManifest: vi.fn(),
    derive: vi.fn(),
}));

vi.mock("@domain/agents/agent-deployment.service.js", () => ({
    AgentDeploymentService: {
        getBySlug: h.getBySlug,
        getByJobId: h.getByJobId,
        upsert: h.upsert,
        updateManifest: h.updateManifest,
    },
}));
vi.mock("@domain/agents/agent-fallback.service.js", () => ({
    agentFallbackService: { derive: h.derive },
}));

import { OrgForgeService } from "../core/org-forge.service.js";

function makeCtx(overrides: Record<string, unknown> = {}) {
    return {
        orgId: 7,
        cycleAppSlug: "wayfare",
        warnings: [] as string[],
        credentialId: 1,
        cycleId: 1,
        agentNameById: { "wayfare-route-architect": "Wayfare Route Architect" },
        agentJobIdById: { "wayfare-route-architect": 42 },
        missionNameById: {},
        dbMissionIdByStringId: {},
        pipelineIdByMissionId: { "mission-initialize-trip": 900 },
        manifest: {
            name: "Wayfare Long-Haul Planner",
            agents: [
                {
                    id: "wayfare-route-architect",
                    name: "Wayfare Route Architect",
                    description: "Plans routes",
                    tools: ["read_file"],
                    soul_profile: { archetype: "planner", legend: "Route planner" },
                    publish_as_public_agent: {
                        slug: "wayfare-route-architect",
                        title: "Wayfare Route Architect",
                        access_policy: "internal_only",
                        welcome_message: "Plan a trip",
                    },
                },
            ],
            missions: [
                {
                    id: "mission-initialize-trip",
                    primary_agent: "wayfare-route-architect",
                    sequence: [{ step_code: "INIT-1", agent: "wayfare-route-architect" }],
                },
            ],
            ...(overrides.manifest as object | undefined),
        },
        ...overrides,
    } as any;
}

describe("OrgForgeService.provisionAgentDeployments", () => {
    let service: OrgForgeService;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new OrgForgeService();
        h.getBySlug.mockResolvedValue(null);
        h.getByJobId.mockResolvedValue(null);
        h.upsert.mockResolvedValue({ id: 555 });
        h.updateManifest.mockResolvedValue({});
        h.derive.mockResolvedValue({});
    });

    it("upserts the deployment, binds mission pipelines, then builds manifest and fallbacks", async () => {
        const ctx = makeCtx();
        const count = await (service as any).provisionAgentDeployments(ctx);

        expect(count).toBe(1);
        expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({
            jobId: 42,
            organizationId: 7,
            slug: "wayfare-route-architect",
            accessPolicy: "internal_only",
            allowedPipelineIds: [900],
            isActive: true,
        }));
        expect(h.updateManifest).toHaveBeenCalledWith(555);
        expect(h.derive).toHaveBeenCalledWith(555);
    });

    it("skips agents without publish_as_public_agent", async () => {
        const ctx = makeCtx({
            manifest: { agents: [{ id: "wayfare-route-architect" }], missions: [] },
        });
        const count = await (service as any).provisionAgentDeployments(ctx);

        expect(count).toBe(0);
        expect(h.upsert).not.toHaveBeenCalled();
    });

    it("refuses to take over a slug owned by a different job", async () => {
        h.getBySlug.mockResolvedValue({ id: 1, jobId: 999 });
        const ctx = makeCtx();
        const count = await (service as any).provisionAgentDeployments(ctx);

        expect(count).toBe(0);
        expect(h.upsert).not.toHaveBeenCalled();
        expect(ctx.warnings.some((w: string) => w.includes("owned by another deployment"))).toBe(true);
    });

    it("updates an existing deployment owned by the same job", async () => {
        h.getBySlug.mockResolvedValue({ id: 5, jobId: 42 });
        const ctx = makeCtx();
        const count = await (service as any).provisionAgentDeployments(ctx);

        expect(count).toBe(1);
        expect(h.upsert).toHaveBeenCalled();
    });

    it("warns and skips when the agent has no provisioned job", async () => {
        const ctx = makeCtx({ agentJobIdById: {} });
        const count = await (service as any).provisionAgentDeployments(ctx);

        expect(count).toBe(0);
        expect(ctx.warnings.some((w: string) => w.includes("no provisioned job"))).toBe(true);
    });

    it("defaults to internal_only when the blueprint declares no access policy", async () => {
        const ctx = makeCtx();
        delete ctx.manifest.agents[0].publish_as_public_agent.access_policy;
        await (service as any).provisionAgentDeployments(ctx);

        expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({ accessPolicy: "internal_only" }));
    });

    it("warns and skips on an invalid slug", async () => {
        const ctx = makeCtx();
        ctx.manifest.agents[0].publish_as_public_agent.slug = "Bad Slug!";
        const count = await (service as any).provisionAgentDeployments(ctx);

        expect(count).toBe(0);
        expect(h.upsert).not.toHaveBeenCalled();
        expect(ctx.warnings.some((w: string) => w.includes("slug"))).toBe(true);
    });

    it("collects a warning instead of throwing when upsert fails", async () => {
        h.upsert.mockRejectedValue(new Error("unique violation"));
        const ctx = makeCtx();
        const count = await (service as any).provisionAgentDeployments(ctx);

        expect(count).toBe(0);
        expect(ctx.warnings.some((w: string) => w.includes("unique violation"))).toBe(true);
    });
});
