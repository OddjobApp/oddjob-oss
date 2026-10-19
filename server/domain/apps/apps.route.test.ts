import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// --- Mocks: auth + org context ---
vi.mock("../../utils/auth-context.js", () => ({
  requireOrgAdminOrSuper: (_req: any, _res: any, next: any) => next(),
  getUserOrgContext: vi.fn(async () => ({ organizationId: 1 })),
}));

// --- Mocks: redis (hoisted so mock factories can reference it safely) ---
const { redisStore, redis } = vi.hoisted(() => {
  const redisStore = new Map<string, string>();
  const redis = {
    get: vi.fn(async (k: string) => redisStore.get(k) ?? null),
    set: vi.fn(async (k: string, v: string, ..._args: any[]) => {
      redisStore.set(k, v);
      return "OK";
    }),
    setex: vi.fn(async (k: string, _ttl: number, v: string) => {
      redisStore.set(k, v);
      return "OK";
    }),
    del: vi.fn(async (...keys: string[]) => {
      for (const k of keys) redisStore.delete(k);
      return keys.length;
    }),
    hset: vi.fn(async () => 1),
    hget: vi.fn(async () => null),
    hgetall: vi.fn(async () => ({})),
    lrange: vi.fn(async (k: string, _start: number, _stop: number) => {
      const raw = redisStore.get(k);
      if (!raw) return [];
      return JSON.parse(raw);
    }),
    lpush: vi.fn(async (k: string, v: string) => {
      const arr = JSON.parse(redisStore.get(k) ?? "[]");
      arr.unshift(v);
      redisStore.set(k, JSON.stringify(arr));
      return arr.length;
    }),
    ltrim: vi.fn(async (_k: string, _start: number, _stop: number) => "OK"),
  };
  return { redisStore, redis };
});

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
  redis,
  nodeRedisClient: redis,
  redisManager: null,
}));

// --- Mocks: appForgeService ---
vi.mock("./app-forge.service.js", () => ({
  appForgeService: {
    forgeApp: vi.fn(async () => ({ success: true, jobId: "job-1" })),
    acquireWarmLease: vi.fn(async () => ({ leaseId: "lease-1", port: 8123 })),
    releaseWarmLease: vi.fn(async () => true),
    listBlueprints: vi.fn(async () => []),
    rollbackToVersion: vi.fn(async () => ({ success: true })),
  },
}));

// --- Mocks: other route dependencies we don't exercise here ---
vi.mock("./app-registry.service.js", () => ({ appRegistryService: {} }));
vi.mock("./app-builder.service.js", () => ({ appBuilderService: {} }));
vi.mock("./app-deployment.service.js", () => ({ AppDeploymentService: {} }));
vi.mock("./core/forge-context.service.js", () => ({ forgeContextService: {} }));
vi.mock("./core/forge-settings.service.js", () => ({ forgeSettingsService: {} }));
vi.mock("@server/utils/logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));
vi.mock("@server/database_service.js", () => ({ db: {} }));

import { appsRouter } from './apps.route.js';
import { appForgeService } from "./app-forge.service.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/apps", appsRouter);
  return app;
}

describe("AppsRoute - Forge warmup/refine/active endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisStore.clear();
  });

  it("POST /api/apps/forge/warmup/lease returns lease info", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/apps/forge/warmup/lease").send({}).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.leaseId).toBe("lease-1");
    expect(appForgeService.acquireWarmLease).toHaveBeenCalledOnce();
  });

  it("POST /api/apps/forge/warmup/release requires leaseId", async () => {
    const app = makeApp();
    await request(app).post("/api/apps/forge/warmup/release").send({}).expect(400);
  });

  it("POST /api/apps/forge/warmup/release releases lease", async () => {
    const app = makeApp();
    const res = await request(app)
      .post("/api/apps/forge/warmup/release")
      .send({ leaseId: "lease-1", dehydrate: true })
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(appForgeService.releaseWarmLease).toHaveBeenCalledWith("lease-1", true);
  });

  it("GET /api/apps/forge/active returns active=false when none", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/apps/forge/active").expect(200);
    expect(res.body.active).toBe(false);
  });

  it("GET /api/apps/forge/active returns most recent active job", async () => {
    const app = makeApp();
    const historyKey = "forge:history:org:1";
    redisStore.set(historyKey, JSON.stringify([JSON.stringify({ jobId: "job-123", slug: "x", name: "X", createdAt: "t" })]));
    redisStore.set("forge:job:job-123", JSON.stringify({ status: "running", updatedAt: "u" }));

    const res = await request(app).get("/api/apps/forge/active").expect(200);
    expect(res.body.active).toBe(true);
    expect(res.body.jobId).toBe("job-123");
    expect(res.body.status).toBe("running");
  });

  it("POST /api/apps/forge/:jobId/refine requires clarification", async () => {
    const app = makeApp();
    await request(app).post("/api/apps/forge/job-1/refine").send({}).expect(400);
  });

  it("POST /api/apps/forge/:jobId/refine re-runs forgeApp with merged userAnswers", async () => {
    const app = makeApp();
    redisStore.set("forge:job:job-1", JSON.stringify({ status: "running" }));
    redisStore.set("forge:config:job-1", JSON.stringify({ blueprintSlug: "analytics-dashboard", options: { slug: "s", name: "n", description: "d", oddjobMissionId: 0 } }));

    const res = await request(app)
      .post("/api/apps/forge/job-1/refine")
      .send({ clarification: "please keep UI simple" })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(appForgeService.forgeApp).toHaveBeenCalledOnce();
    const [, options] = (appForgeService.forgeApp as any).mock.calls[0];
    expect(options.jobId).toBe("job-1");
    expect(options.isApprovedPlan).toBe(false);
    expect(options.userAnswers.refinementNote).toBe("please keep UI simple");
  });

  it("POST /api/apps/forge truncates description, parses collections, and forwards warmLeaseId", async () => {
    const app = makeApp();
    const slug = `forge-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await request(app)
      .post("/api/apps/forge")
      .send({
        name: "Forge Test App",
        slug,
        description: "x".repeat(400),
        blueprint: "analytics-dashboard",
        warmLeaseId: "lease-warm-1",
        skipToAssembly: true,
        defaultCollections: " contacts , leads ",
        approvedPlan: { wizard: true },
      })
      .expect(200);

    expect(res.body.jobId).toBeTruthy();
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    expect(appForgeService.forgeApp).toHaveBeenCalled();
    const [, options] = (appForgeService.forgeApp as any).mock.calls[0];
    expect(options.warmLeaseId).toBe("lease-warm-1");
    expect(options.description.length).toBe(350);
    expect(options.defaultCollections).toEqual(["contacts", "leads"]);
    expect(options.approvedPlan).toEqual({ wizard: true });
    expect(options.skipToAssembly).toBe(true);
  });

  it("POST /api/apps/forge creates a server-side draft record", async () => {
    const app = makeApp();
    const slug = `draft-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await request(app)
      .post("/api/apps/forge")
      .send({
        name: "Draft Test App",
        slug,
        description: "draft me",
        blueprint: "analytics-dashboard",
        defaultCollections: "one, two",
      })
      .expect(200);

    const draftRaw = redisStore.get(`forge:draft:${res.body.jobId}`);
    expect(draftRaw).toBeTruthy();
    const draft = JSON.parse(draftRaw!);
    expect(draft.slug).toBe(slug);
    expect(draft.status).toBe("queued");
    expect(draft.options.defaultCollections).toEqual(["one", "two"]);
  });

  it("GET /api/apps/forge/drafts lists server-side forge drafts for the org", async () => {
    const app = makeApp();
    redisStore.set("forge:drafts:org:1", JSON.stringify(["draft-job-1"]));
    redisStore.set("forge:draft:draft-job-1", JSON.stringify({
      jobId: "draft-job-1",
      organizationId: 1,
      blueprintSlug: "analytics-dashboard",
      options: { name: "Drafted", slug: "drafted", description: "d", oddjobMissionId: 0, organizationId: 1 },
      name: "Drafted",
      slug: "drafted",
      status: "failed",
      attempt: 1,
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:00.000Z",
    }));

    const res = await request(app).get("/api/apps/forge/drafts").expect(200);
    expect(res.body.count).toBe(1);
    expect(res.body.drafts[0].jobId).toBe("draft-job-1");
    expect(res.body.drafts[0].status).toBe("failed");
  });

  it("GET /api/apps/forge/status/:jobId falls back to draft when transient status expired", async () => {
    const app = makeApp();
    redisStore.set("forge:draft:expired-status-job", JSON.stringify({
      jobId: "expired-status-job",
      organizationId: 1,
      blueprintSlug: "analytics-dashboard",
      options: { name: "Recoverable", slug: "recoverable", description: "d", oddjobMissionId: 0, organizationId: 1 },
      name: "Recoverable",
      slug: "recoverable",
      status: "failed",
      error: "QA failed",
      attempt: 1,
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:00.000Z",
    }));

    const res = await request(app).get("/api/apps/forge/status/expired-status-job").expect(200);
    expect(res.body.jobId).toBe("expired-status-job");
    expect(res.body.status).toBe("failed");
    expect(res.body.error).toBe("QA failed");
  });

  it("GET /api/apps/forge/status/:jobId hides a job belonging to another organization", async () => {
    // This route read no org context at all: any org admin could fetch any job by
    // id and receive the entire draft, including options.description and
    // apiInstructions. 404 rather than 403 — confirming the id exists would still
    // disclose something about an organization the caller cannot see.
    const app = makeApp();
    redisStore.set("forge:draft:other-org-job", JSON.stringify({
      jobId: "other-org-job",
      organizationId: 999,
      blueprintSlug: "crud-app",
      options: { name: "Their App", slug: "their-app", description: "commercially sensitive", oddjobMissionId: 0 },
      name: "Their App",
      slug: "their-app",
      status: "building",
      attempt: 1,
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:00.000Z",
    }));

    const res = await request(app).get("/api/apps/forge/status/other-org-job").expect(404);
    expect(JSON.stringify(res.body)).not.toMatch(/commercially sensitive|their-app/);
  });

  it("GET /api/apps/forge/active/:slug does not answer for another organization's app", async () => {
    // forge:active:<slug> has no org in the key at all, so this answered for every
    // organization — and handed back the jobId, which was the key to the status
    // route above. The two chained into a full cross-tenant read.
    const app = makeApp();
    redisStore.set("forge:active:their-app", "other-org-job-2");
    redisStore.set("forge:job:other-org-job-2", JSON.stringify({ status: "building", progress: 40 }));
    redisStore.set("forge:draft:other-org-job-2", JSON.stringify({
      jobId: "other-org-job-2",
      organizationId: 999,
      blueprintSlug: "crud-app",
      options: { name: "Their App", slug: "their-app", description: "d", oddjobMissionId: 0 },
      name: "Their App",
      slug: "their-app",
      status: "building",
      attempt: 1,
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:00.000Z",
    }));

    const res = await request(app).get("/api/apps/forge/active/their-app").expect(200);

    expect(res.body.active).toBe(false);
    // The jobId must not come back either; it was the handle to the other route.
    expect(res.body.jobId).toBeUndefined();
  });

  it("GET /api/apps/forge/active/:slug still reports the caller's own build", async () => {
    const app = makeApp();
    redisStore.set("forge:active:my-app", "my-job");
    redisStore.set("forge:job:my-job", JSON.stringify({ status: "building", progress: 40 }));
    redisStore.set("forge:draft:my-job", JSON.stringify({
      jobId: "my-job",
      organizationId: 1,
      blueprintSlug: "crud-app",
      options: { name: "My App", slug: "my-app", description: "d", oddjobMissionId: 0 },
      name: "My App",
      slug: "my-app",
      status: "building",
      attempt: 1,
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:00.000Z",
    }));

    const res = await request(app).get("/api/apps/forge/active/my-app").expect(200);

    expect(res.body.active).toBe(true);
    expect(res.body.jobId).toBe("my-job");
  });

  it("POST /api/apps/forge/drafts/:jobId/restart re-queues a failed draft", async () => {
    const app = makeApp();
    redisStore.set("forge:draft:restart-job", JSON.stringify({
      jobId: "restart-job",
      organizationId: 1,
      blueprintSlug: "analytics-dashboard",
      options: { name: "Restartable", slug: "restartable", description: "d", oddjobMissionId: 0, organizationId: 1 },
      name: "Restartable",
      slug: "restartable",
      status: "failed",
      error: "Build failed",
      attempt: 1,
      createdAt: "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:00.000Z",
    }));

    const res = await request(app).post("/api/apps/forge/drafts/restart-job/restart").send({}).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.jobId).toBe("restart-job");
    expect(appForgeService.forgeApp).toHaveBeenCalled();
    const [, options] = (appForgeService.forgeApp as any).mock.calls.at(-1);
    expect(options.jobId).toBe("restart-job");
    expect(options.blackboard.restartedFromDraft).toBe(true);
  });
});

