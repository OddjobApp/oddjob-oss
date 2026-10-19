/**
 * Generation Sessions API — endpoint tests (plan task 12.1).
 *
 * Mounts the real router with supertest; services, auth, db, and the event
 * stream are mocked so the tests exercise the HTTP contract and in-handler logic
 * (artifact lookup + 404, event cursor/ordering, intervention state guards).
 *
 * @vitest-environment node
 */
import express from "express";
import request from "supertest";
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  emitEvent: vi.fn(),
  getPhaseArtifacts: vi.fn(),
  queryEvents: vi.fn(),
  org: { organizationId: 1, userId: "u1" } as { organizationId: number | null; userId: string },
}));

vi.mock("@domain/sdlc-pipeline/index.js", () => ({
  pipelineOrchestratorService: { getSession: h.getSession },
  sessionLifecycleManager: { emitEvent: h.emitEvent },
  artifactRegistryService: { getPhaseArtifacts: h.getPhaseArtifacts, getSessionLineage: vi.fn() },
}));
vi.mock("@server/database_service.js", () => ({
  db: { update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }) },
}));
vi.mock("@domain/core/infrastructure/event-stream.service.js", () => ({
  eventStream: { queryEvents: h.queryEvents },
}));
vi.mock("@server/utils/auth-context.js", () => ({
  getUserOrgContext: vi.fn(async () => h.org),
}));
vi.mock("@domain/core/auth/security.service.js", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import router from "@server/routes/generation-sessions.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/generation-sessions", router);
  // Minimal error handler mapping AppError.statusCode -> HTTP status.
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode ?? err.status ?? 500).json({ error: err.message });
  });
  return app;
}

const app = makeApp();

beforeEach(() => {
  vi.clearAllMocks();
  h.org = { organizationId: 1, userId: "u1" };
});

describe("GET /:id/artifacts/:phase/:name", () => {
  it("returns the named artifact (200)", async () => {
    h.getPhaseArtifacts.mockResolvedValue([{ name: "edit_plan", version: 1, content: {} }]);
    const res = await request(app).get("/api/generation-sessions/s1/artifacts/planning/edit_plan");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("edit_plan");
  });

  it("returns 404 when the named artifact is absent", async () => {
    h.getPhaseArtifacts.mockResolvedValue([{ name: "something_else", version: 1, content: {} }]);
    const res = await request(app).get("/api/generation-sessions/s1/artifacts/planning/edit_plan");
    expect(res.status).toBe(404);
  });

  it("forwards the ?version query param to the registry", async () => {
    h.getPhaseArtifacts.mockResolvedValue([{ name: "edit_plan", version: 2, content: {} }]);
    await request(app).get("/api/generation-sessions/s1/artifacts/planning/edit_plan?version=2");
    expect(h.getPhaseArtifacts).toHaveBeenCalledWith("s1", "planning", 2);
  });
});

describe("GET /:id/events", () => {
  it("returns events filtered by session, ordered chronologically, with a cursor", async () => {
    h.getSession.mockResolvedValue({ id: "s1", status: "active" });
    h.queryEvents.mockResolvedValue([
      { eventType: "pipeline.phase_completed", timestamp: 2000, payload: {}, context: { subject: "session:s1" } },
      { eventType: "pipeline.phase_started", timestamp: 1000, payload: {}, context: { subject: "session:s1" } },
      { eventType: "pipeline.other", timestamp: 3000, payload: {}, context: { subject: "session:OTHER" } },
    ]);
    const res = await request(app).get("/api/generation-sessions/s1/events");
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(2); // OTHER session filtered out
    expect(res.body.events[0].eventType).toBe("phase_started"); // sorted ascending, prefix stripped
    expect(res.body.events[1].eventType).toBe("phase_completed");
    expect(res.body.cursor).toBe(new Date(2000).toISOString());
  });

  it("returns 404 for an unknown session", async () => {
    h.getSession.mockResolvedValue(null);
    const res = await request(app).get("/api/generation-sessions/nope/events");
    expect(res.status).toBe(404);
  });
});

describe("intervention endpoints", () => {
  it("approve-scope returns 409 when the session is not blocked/paused", async () => {
    h.getSession.mockResolvedValue({ id: "s1", status: "active", metadata: {} });
    const res = await request(app).post("/api/generation-sessions/s1/approve-scope");
    expect(res.status).toBe(409);
    expect(res.body.currentStatus).toBe("active");
  });

  it("approve-scope transitions a blocked session to active (200) and emits an event", async () => {
    h.getSession
      .mockResolvedValueOnce({ id: "s1", status: "blocked", metadata: {} }) // pre-check
      .mockResolvedValueOnce({ id: "s1", status: "active", metadata: {} }); // updated
    const res = await request(app).post("/api/generation-sessions/s1/approve-scope");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
    expect(h.emitEvent).toHaveBeenCalledOnce();
  });

  it("force-approve-gate returns 409 unless the session is blocked", async () => {
    h.getSession.mockResolvedValue({ id: "s1", status: "active", metadata: {} });
    const res = await request(app).post("/api/generation-sessions/s1/force-approve-gate").send({ reason: "ok" });
    expect(res.status).toBe(409);
  });

  it("resume-budget returns 409 unless the session is paused", async () => {
    h.getSession.mockResolvedValue({ id: "s1", status: "active", metadata: {} });
    const res = await request(app).post("/api/generation-sessions/s1/resume-budget").send({ newBudgetLimitUsd: 5 });
    expect(res.status).toBe(409);
  });

  it("resume-budget resumes a paused session (200)", async () => {
    h.getSession
      .mockResolvedValueOnce({ id: "s1", status: "paused", metadata: {} })
      .mockResolvedValueOnce({ id: "s1", status: "active", metadata: {} });
    const res = await request(app).post("/api/generation-sessions/s1/resume-budget").send({ newBudgetLimitUsd: 5 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
  });
});
