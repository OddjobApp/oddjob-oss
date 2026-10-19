import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../utils/auth-context.js", () => ({
  requireOrgAdminOrSuper: (_req: any, _res: any, next: any) => next(),
  getUserOrgContext: vi.fn(async () => ({ organizationId: 1 })),
}));

const { appDeploymentService } = vi.hoisted(() => ({
  appDeploymentService: {
    getByAppAndOrg: vi.fn(),
    updateDeploymentPublishing: vi.fn(),
    getPipelineJobType: vi.fn(() => null),
    getPipelineReadiness: vi.fn(() => ({ ready: false, reason: "no_pipeline" })),
    ensurePipelineRunnableJob: vi.fn(async () => ({ jobId: null })),
    getDeploymentAnalytics: vi.fn(async () => ({})),
    uninstallDeployment: vi.fn(async () => {}),
    getHealthStatus: vi.fn(async () => ({ status: "healthy" })),
    getPublicDeployment: vi.fn(async () => null),
    getBySlug: vi.fn(async () => null),
  },
}));

const { appRegistryService, agentDeploymentService } = vi.hoisted(() => ({
  appRegistryService: {
    listOrgDeployments: vi.fn(),
    startApp: vi.fn(async () => ({ instanceId: 9, port: 4010 })),
    getApp: vi.fn(async () => ({ id: 42, slug: "dispatcher", developerOrgId: 1 })),
  },
  agentDeploymentService: {
    listDeployments: vi.fn(),
  },
}));

vi.mock("./app-deployment.service.js", () => ({
  AppDeploymentService: appDeploymentService,
}));

vi.mock("./app-registry.service.js", () => ({ appRegistryService }));
vi.mock("@domain/agents/agent-deployment.service.js", () => ({
  AgentDeploymentService: agentDeploymentService,
}));
const { appBuilderService, forgeDesignCatalogService } = vi.hoisted(() => ({
  appBuilderService: {
    previewEnhancementPlan: vi.fn(async () => ({ success: true, risk: "low", likelyFiles: ["public/styles.css"] })),
    enhanceApp: vi.fn(async () => ({ success: true, filesWritten: 1 })),
  },
  forgeDesignCatalogService: {
    getStyleById: vi.fn(async (id: string) => ({ id, name: "Editorial", tagline: "Warm", colors: {} })),
    toPromptContext: vi.fn(() => "DESIGN IDENTITY: Editorial"),
  },
}));
vi.mock("./app-builder.service.js", () => ({ appBuilderService }));
vi.mock("./core/forge-design-catalog.service.js", () => ({ forgeDesignCatalogService }));
vi.mock("./app-forge.service.js", () => ({
  appForgeService: {
    listBlueprints: vi.fn(async () => []),
  },
}));
vi.mock("./core/forge-context.service.js", () => ({ forgeContextService: {} }));
vi.mock("./core/forge-settings.service.js", () => ({ forgeSettingsService: {} }));
// An empty object was enough when this was written; /api/apps/fleet now asks
// for the agent jobs' configs to tell a live Agent AI deployment from an app,
// so the route died on "getAgentJobConfigs is not a function" and the test saw
// only a 500. The real one returns a Map keyed by job id.
vi.mock("./core/app-query.service.js", () => ({
  appQueryService: {
    getAgentJobConfigs: vi.fn(async () => new Map<number, any>()),
  },
}));
vi.mock("./core/forge-lifecycle.service.js", () => ({ forgeLifecycleService: {} }));
const { appReadinessService } = vi.hoisted(() => ({
  appReadinessService: {
    getAppReadiness: vi.fn(async () => ({ ready: true, checks: [] })),
  },
}));
vi.mock("./core/app-readiness.service.js", () => ({ appReadinessService }));
vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
  redis: {
    hset: vi.fn(async () => 1),
    hget: vi.fn(async () => null),
    hgetall: vi.fn(async () => ({})),
    get: vi.fn(async () => null),
    set: vi.fn(async () => "OK"),
    setex: vi.fn(async () => "OK"),
    del: vi.fn(async () => 1),
    lpush: vi.fn(async () => 1),
    ltrim: vi.fn(async () => "OK"),
    lrange: vi.fn(async () => []),
  },
  nodeRedisClient: {
    hset: vi.fn(async () => 1),
    hget: vi.fn(async () => null),
    hgetall: vi.fn(async () => ({})),
  },
  redisManager: null,
}));
const { agentJobRows } = vi.hoisted(() => ({
  // Configs for the ai_agent jobs behind the agent deployments below. Empty configs
  // mean "no parent cycle", i.e. org-native agents, which is what this test asserts.
  agentJobRows: [
    { id: 700, config: {} },
    { id: 701, config: {} },
  ],
}));

vi.mock("@server/database_service.js", () => ({
  // GET /fleet joins these job configs to find each agent's parent cycle for the
  // Arsenal's grouping. `db: {}` made db.select a TypeError, so every fleet request
  // was a 500 — the route grew the join and the mock never followed.
  db: {
    select: () => ({ from: () => ({ where: async () => agentJobRows }) }),
  },
}));
vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { appsRouter } from "./apps.route.js";

const existingDeployment = {
  id: 10,
  appId: 42,
  organizationId: 1,
  publicSlug: "dispatcher",
  isPublished: true,
  title: "Dispatcher",
  description: "Dispatch app",
  brandingConfig: {},
  accessPolicy: "password",
  accessPasswordHash: "existing-password-hash",
  budgetLimitUsd: null,
  userBudgetLimit: null,
  defaultModel: "gpt-4o",
  systemPrompt: "",
  appMemoryEnabled: false,
  hilEnabled: false,
  webhookUrl: null,
  webhookType: "generic",
  webhookSecret: null,
  nextPipelineId: null,
  expertiseJobId: null,
  allowedTopicIds: [],
  allowedDatasetIds: [],
  allowedAgentIds: [],
  allowedPipelineIds: [],
  defaultCollections: [],
  allowedTools: [],
  reasoningProtocol: "json_manifest",
  intelligenceCategory: null,
  deploymentMode: "chat",
  browserStartUrl: null,
  browserGoal: null,
  browserConfig: {},
  navigationalMemoryShared: true,
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/apps", appsRouter);
  return app;
}

describe("AppsRoute - deployment updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appDeploymentService.getByAppAndOrg.mockResolvedValue(existingDeployment);
    appDeploymentService.updateDeploymentPublishing.mockImplementation(async (_appId, _orgId, data) => ({
      ...existingDeployment,
      ...data,
    }));
    appRegistryService.listOrgDeployments.mockResolvedValue([
      {
        deployment: existingDeployment,
        app: {
          id: 42,
          name: "Dispatcher",
          slug: "dispatcher",
          description: "Dispatch app",
          version: "1.0.0",
          status: "active",
        },
      },
    ]);
    agentDeploymentService.listDeployments.mockResolvedValue([
      {
        id: 77,
        jobId: 700,
        organizationId: 1,
        slug: "published-agent",
        title: "Published Agent",
        description: "Public agent",
        isActive: true,
        allowedPipelineIds: [44],
        updatedAt: new Date("2026-05-20T12:00:00.000Z"),
      },
      {
        id: 78,
        jobId: 701,
        organizationId: 1,
        slug: "draft-agent",
        title: "Draft Agent",
        description: "Not public",
        isActive: false,
        allowedPipelineIds: [],
        updatedAt: new Date("2026-05-21T12:00:00.000Z"),
      },
    ]);
  });

  it("persists app platform-resource access fields from partial deployment saves", async () => {
    await request(makeApp())
      .post("/api/apps/42/deploy")
      .send({
        allowedTopicIds: [11],
        allowedDatasetIds: [22],
        allowedAgentIds: [33],
        allowedPipelineIds: [44, 45],
        defaultCollections: ["contacts", "leads"],
      })
      .expect(200);

    expect(appDeploymentService.updateDeploymentPublishing).toHaveBeenCalledWith(
      42,
      1,
      expect.objectContaining({
        accessPolicy: "password",
        accessPasswordHash: "existing-password-hash",
        allowedTopicIds: [11],
        allowedDatasetIds: [22],
        allowedAgentIds: [33],
        allowedPipelineIds: [44, 45],
        defaultCollections: ["contacts", "leads"],
      }),
    );
  });

  it("only clears an existing password hash when access policy changes away from password", async () => {
    await request(makeApp())
      .post("/api/apps/42/deploy")
      .send({ allowedPipelineIds: [44] })
      .expect(200);

    expect(appDeploymentService.updateDeploymentPublishing).toHaveBeenLastCalledWith(
      42,
      1,
      expect.objectContaining({
        accessPolicy: "password",
        accessPasswordHash: "existing-password-hash",
      }),
    );

    await request(makeApp())
      .post("/api/apps/42/deploy")
      .send({ accessPolicy: "public" })
      .expect(200);

    expect(appDeploymentService.updateDeploymentPublishing).toHaveBeenLastCalledWith(
      42,
      1,
      expect.objectContaining({
        accessPolicy: "public",
        accessPasswordHash: null,
      }),
    );
  });

  it("starts and probes an app before publishing it", async () => {
    await request(makeApp())
      .post("/api/apps/42/deploy")
      .send({ isPublished: true, publicSlug: "dispatcher" })
      .expect(200);

    expect(appRegistryService.startApp).toHaveBeenCalledWith(42, 1);
    expect(appReadinessService.getAppReadiness).toHaveBeenCalledWith(42, 1, { probeRuntime: true });
  });

  it("does not persist publication when readiness has a blocker", async () => {
    appReadinessService.getAppReadiness.mockResolvedValueOnce({
      ready: false,
      checks: [{ status: "fail", severity: "blocker", message: "Runtime did not respond." }],
    } as any);

    await request(makeApp())
      .post("/api/apps/42/deploy")
      .send({ isPublished: true, publicSlug: "dispatcher" })
      .expect(400);

    expect(appDeploymentService.updateDeploymentPublishing).not.toHaveBeenCalled();
  });

  it("previews a catalog theme under a visual-only fidelity contract", async () => {
    const res = await request(makeApp())
      .post("/api/apps/42/theme-plan")
      .send({ styleId: "editorial", embellishment: "subtle motion" })
      .expect(200);

    expect(res.body.style).toEqual({ id: "editorial", name: "Editorial", tagline: "Warm" });
    expect(appBuilderService.previewEnhancementPlan).toHaveBeenCalledWith(
      42,
      "dispatcher",
      expect.stringContaining("Preserve every feature"),
      1,
    );
    expect((appBuilderService.previewEnhancementPlan.mock.calls as any[][])[0][2]).toContain("subtle motion");
  });

  it("returns a unified App Arsenal fleet without mirroring Agent AIs as apps", async () => {
    const res = await request(makeApp())
      .get("/api/apps/fleet")
      .expect(200);

    expect(res.body).toHaveLength(2);
    expect(res.body.map((item: any) => item.source)).toEqual(["agent_ai", "app"]);
    expect(res.body[0]).toEqual(expect.objectContaining({
      source: "agent_ai",
      id: "agent-77",
      title: "Published Agent",
      publicPath: "/a/published-agent",
      configurePath: "/agents/700?tab=publish",
    }));
    expect(res.body[0].agentDeployment).toEqual(expect.objectContaining({
      jobId: 700,
      allowedPipelineIds: [44],
    }));
    expect(res.body[1]).toEqual(expect.objectContaining({
      source: "app",
      id: "app-10",
      title: "Dispatcher",
      publicPath: "/app/dispatcher",
      configurePath: "/armory/apps/42",
    }));
    expect(appRegistryService.listOrgDeployments).toHaveBeenCalledWith(1);
    expect(agentDeploymentService.listDeployments).toHaveBeenCalledWith(1);
  });
});
