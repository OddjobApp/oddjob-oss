import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { agentDeploymentService, agentService } = vi.hoisted(() => ({
  agentDeploymentService: {
    getBySlug: vi.fn(),
    getById: vi.fn(),
    getOrgSettings: vi.fn(),
    listDeployments: vi.fn(),
    getByJobId: vi.fn(),
    getJobById: vi.fn(),
    upsert: vi.fn(),
    updateDeployment: vi.fn(),
    updateManifest: vi.fn(),
    updateBranding: vi.fn(),
    listRecentMessages: vi.fn(),
    listRecentSteps: vi.fn(),
  },
  agentService: {
    chat: vi.fn(),
  },
}));

vi.mock("@domain/agents/agent-deployment.service.js", () => ({
  AgentDeploymentService: agentDeploymentService,
}));

vi.mock("@domain/agents/agent.service.js", () => ({
  agentService,
}));

vi.mock("@domain/core/auth/security.service.js", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));

const { orgContext } = vi.hoisted(() => ({
  orgContext: {
    organizationId: null,
    userId: "public-session",
    isAdmin: false,
    isSuperAdmin: false,
    isOrgAdmin: false,
  } as any,
}));

vi.mock("../../utils/auth-context.js", () => ({
  getUserOrgContext: vi.fn(async () => orgContext),
}));

vi.mock("@server/domain/auth/index.js", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    hashPassword: vi.fn(async () => "hash"),
    verifyPassword: vi.fn(async () => true),
  };
});

vi.mock("../../middleware/agent-access-audit.js", () => ({
  agentAccessAuditMiddleware: (_req: any, _res: any, next: any) => next(),
  agentRateLimitMiddleware: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@domain/org/core/organization.service.js", () => ({
  organizationService: {},
}));

vi.mock("@domain/jobs/job.service.js", () => ({
  jobService: {},
}));

vi.mock("@domain/auth/core/embed-oauth.service.js", () => ({
  createOAuthState: vi.fn(() => "state"),
  consumeOAuthState: vi.fn(() => null),
  getAuthorizationUrl: vi.fn(() => null),
  exchangeCodeForTokens: vi.fn(async () => null),
  buildEmbedOAuthCookie: vi.fn(() => "oauth=token"),
  getEmbedOAuthTokenFromCookie: vi.fn(() => null),
}));

vi.mock("../../routes/agent-analytics.js", async () => {
  const { Router } = await import("express");
  return { default: Router() };
});

vi.mock("../../routes/agent-hints.js", async () => {
  const { Router } = await import("express");
  return { default: Router() };
});

import { registerAgentDeploymentRoutes } from "../../routes/agent-deployments.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  registerAgentDeploymentRoutes(app);
  return app;
}

describe("Agent deployment public routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgContext.organizationId = null;
    orgContext.userId = "public-session";
  });

  it("does not expose inactive Agent AI deployments publicly", async () => {
    agentDeploymentService.getBySlug.mockResolvedValue({
      id: 12,
      jobId: 34,
      organizationId: 1,
      slug: "quiet-agent",
      title: "Quiet Agent",
      description: "Inactive deployment",
      isActive: false,
      accessPolicy: "public",
    });

    await request(makeApp())
      .get("/api/public/agents/quiet-agent")
      .expect(404);

    await request(makeApp())
      .post("/api/public/agents/quiet-agent/chat")
      .send({ message: "hello", sessionId: "s1" })
      .expect(404);

    expect(agentService.chat).not.toHaveBeenCalled();
  });

  it("lets an organization user pause an Agent AI deployment by deployment id", async () => {
    orgContext.organizationId = 1;
    orgContext.userId = "owner";
    agentDeploymentService.getById.mockResolvedValue({
      id: 12,
      jobId: 34,
      organizationId: 1,
      slug: "quiet-agent",
      title: "Quiet Agent",
      isActive: true,
    });
    agentDeploymentService.updateDeployment.mockResolvedValue({
      id: 12,
      jobId: 34,
      organizationId: 1,
      slug: "quiet-agent",
      title: "Quiet Agent",
      isActive: false,
    });

    const res = await request(makeApp())
      .patch("/api/agents/deployments/12")
      .send({ isActive: false })
      .expect(200);

    expect(res.body).toEqual(expect.objectContaining({ id: 12, isActive: false }));
    expect(agentDeploymentService.updateDeployment).toHaveBeenCalledWith(12, { isActive: false });
  });
});
