import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// requireAuth is the only gate in front of every route here; give it a user so
// the handlers themselves are what the assertions observe.
vi.mock("@domain/core/auth/security.service.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 1, email: "approver@example.com", adminRole: { isSuperAdmin: true, organizationId: 1 } };
    next();
  },
}));

vi.mock("@server/utils/auth-context.js", () => ({
  getUserOrgContext: vi.fn(async () => ({ organizationId: 1 })),
  requireOrgId: (context: any) => context.organizationId,
}));

vi.mock("@server/utils/organization-permissions.js", () => ({
  requireOrganizationPermission: () => (_req: any, _res: any, next: any) => next(),
}));

const { approvalService } = vi.hoisted(() => ({
  approvalService: {
    listPending: vi.fn(async () => []),
    getById: vi.fn(async (id: number) => ({ id })),
    processDecision: vi.fn(async () => ({ ok: true })),
    snooze: vi.fn(async () => ({ ok: true })),
  },
}));
vi.mock("../core/approval.service.js", () => ({ approvalService }));

vi.mock("@server/database_service.js", () => ({ db: {} }));

vi.mock("@domain/cache/cache.service.js", () => ({
  cacheService: {
    getOrFetch: vi.fn(async (_key: string, fetcher: () => Promise<unknown>) => fetcher()),
    invalidate: vi.fn(async () => {}),
    invalidateByTag: vi.fn(async () => {}),
  },
}));

// Both streaming endpoints and both exports reach for these via dynamic import
// inside the handler, so the mock has to stand in for the real modules.
const { streamPaginated, createPaginator } = vi.hoisted(() => ({
  streamPaginated: vi.fn(async (res: any, format: string) => {
    res.status(200).json({ reached: "streamPaginated", format });
  }),
  createPaginator: vi.fn(() => ({ getPageByOffset: vi.fn(async () => ({ items: [], nextCursor: null })) })),
}));
vi.mock("@domain/streaming/streaming.service.js", () => ({
  StreamController: { streamPaginated },
}));
vi.mock("@domain/pagination/pagination.service.js", () => ({ createPaginator }));
const { synthesizeFromIntervention } = vi.hoisted(() => ({
  synthesizeFromIntervention: vi.fn(async () => ({
    skill: { id: 10, name: "synthesized_skill" },
    version: { id: 20, source: "hil_synthesis" },
    strategyDescription: "Test strategy",
  })),
}));
vi.mock("@domain/mission/core/skill-generator.service.js", () => ({
  skillGeneratorService: { synthesizeFromIntervention },
}));

const accounts = vi.hoisted(() => ({ options: vi.fn(), clearPreference: vi.fn(), projectForRoom: vi.fn() }));
vi.mock("../core/outbound-email-accounts.service.js", () => ({ outboundEmailAccounts: accounts }));

async function buildApp() {
  const { default: router } = await import("./approvals.js");
  const app = express();
  app.use(express.json());
  app.use("/api/approvals", router);
  return app;
}

describe("approvals route table", () => {
  it("authorizes the approval before offering scoped sender identities", async () => {
    approvalService.getById.mockResolvedValueOnce({ id: 99, toolArgs: { kind: "outbound_message", channel: "email", sessionKey: "room-a" } } as any);
    accounts.projectForRoom.mockResolvedValue(7); accounts.options.mockResolvedValue({ accounts: [], preferredConnectorId: null });
    const response = await request(await buildApp()).get("/api/approvals/99/email-accounts?organizationId=1");
    expect(response.status).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
    expect(approvalService.getById).toHaveBeenCalledWith(99, 1, "approver@example.com", 1, expect.anything());
    expect(accounts.options).toHaveBeenCalledWith(1, "1", 7);
  });
  it("never offers sender accounts when approval access is denied", async () => {
    approvalService.getById.mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { status: 403 }));
    const response = await request(await buildApp()).get("/api/approvals/99/email-accounts?organizationId=1");
    expect(response.status).toBe(403); expect(accounts.options).not.toHaveBeenCalled();
  });
  it("forgets only the signed-in user's preference in the selected organization", async () => {
    expect((await request(await buildApp()).delete("/api/approvals/email-sender/preference?organizationId=1")).status).toBe(204);
    expect(accounts.clearPreference).toHaveBeenCalledWith(1, "1");
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["approved", "rejected"])("accepts a %s decision at the deliberation endpoint", async (decision) => {
    const app = await buildApp();
    const res = await request(app).post("/api/approvals/519/decision").send({ decision, comments: "Keep the previous take" });
    expect(res.status).toBe(200);
    expect(approvalService.processDecision).toHaveBeenCalledWith(519, {
      decision, comments: "Keep the previous take", modifiedOutput: undefined,
    }, 1, "approver@example.com", { isSuperAdmin: true, organizationId: 1 });
  });

  // GET "/:id" is a single-segment pattern, so it matches the literal segments
  // "stream", "export.csv" and "export.jsonl" too. Express resolves in
  // registration order, so whichever of the two is declared first wins for all
  // three, and parseInt("stream") hands the detail handler a NaN id.
  it.each([
    ["/api/approvals/stream", "sse"],
    ["/api/approvals/export.csv", "csv"],
    ["/api/approvals/export.jsonl", "jsonl"],
  ])("%s reaches its own handler, not the :id detail handler", async (path, format) => {
    const app = await buildApp();

    const res = await request(app).get(path);

    expect(approvalService.getById).not.toHaveBeenCalled();
    expect(streamPaginated).toHaveBeenCalledTimes(1);
    expect(res.body).toEqual({ reached: "streamPaginated", format });
  });

  it("still routes a numeric id to the detail handler", async () => {
    const app = await buildApp();

    const res = await request(app).get("/api/approvals/42");

    expect(streamPaginated).not.toHaveBeenCalled();
    expect(approvalService.getById).toHaveBeenCalledTimes(1);
    expect(approvalService.getById).toHaveBeenCalledWith(42, 1, "approver@example.com", 1, {
      isSuperAdmin: true,
      organizationId: 1,
    });
    expect(res.body).toEqual({ id: 42 });
  });

  it("does not let the detail handler run with a NaN id", async () => {
    const app = await buildApp();

    await request(app).get("/api/approvals/not-a-number");

    // Whatever the response is, the one thing that must never happen is a
    // database lookup keyed by NaN.
    for (const call of approvalService.getById.mock.calls) {
      expect(Number.isNaN(call[0])).toBe(false);
    }
  });

  it("synthesizes an autonomous skill from approval intervention", async () => {
    const app = await buildApp();
    const res = await request(app)
      .post("/api/approvals/519/synthesize-skill")
      .send({ skillName: "custom_skill_name" });

    expect(res.status).toBe(200);
    expect(synthesizeFromIntervention).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalRequestId: 519,
        organizationId: 1,
        skillName: "custom_skill_name",
      }),
    );
    expect(res.body.message).toContain("Skill synthesized successfully");
  });
});
