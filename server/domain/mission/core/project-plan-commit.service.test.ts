/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit coverage for the commit service: wave -> blueprint mapping, project
 * resolution, and the replay/conflict decision. The transaction is a fake, so
 * the advisory lock and the jsonb key lookup are NOT exercised here — the
 * integration test (tests/integration/project-plan-commit.integration.test.ts)
 * runs those against Postgres.
 */

const h = vi.hoisted(() => ({
  existing: [] as any[],
  inserted: { cycle: null as any, blueprints: null as any },
  emit: vi.fn(),
  getProject: vi.fn(),
  assertCanEdit: vi.fn(),
  findSession: vi.fn(),
  findSessionById: vi.fn(),
}));

vi.mock("@server/database_service.js", () => {
  const tx = {
    execute: vi.fn(async () => undefined),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => h.existing }) }) }),
    insert: () => ({
      values: (v: any) => {
        if (Array.isArray(v)) {
          h.inserted.blueprints = v;
          return Promise.resolve();
        }
        h.inserted.cycle = v;
        return { returning: async () => [{ id: 41, ...v }] };
      },
    }),
  };
  return { db: { transaction: async (fn: any) => fn(tx) } };
});
vi.mock("./cycle-manager.service.js", () => ({ emitCycleEvent: h.emit }));
vi.mock("@server/utils/cache-utils.js", () => ({ invalidateCachePattern: vi.fn(async () => undefined) }));
vi.mock("@domain/cache/cache.service.js", () => ({ cacheService: { invalidate: vi.fn(async () => undefined) } }));
vi.mock("@domain/projects/core/project.service.js", () => ({
  projectService: { getProject: h.getProject, assertCanEdit: h.assertCanEdit },
}));
vi.mock("@domain/crew/core/crew-repository.js", () => ({
  crewRepository: { findSession: h.findSession, findSessionById: h.findSessionById },
}));

import { commitProjectPlan, planDigest, toRuntimeBlueprints } from "./project-plan-commit.service.js";
import { planFromCycle, projectPlanFieldsSchema } from "@shared/project-plan-commit.js";

const plan = projectPlanFieldsSchema.parse({
  projectTitle: "Incident remediation",
  objective: "Remediate and sign off",
  budgetLimitUsd: 250,
  tokenLimit: 2_500_000,
  maxParallelMissions: 3,
  targetSlaDays: 5,
  waves: [
    {
      id: "w1", name: "Discovery", waveNumber: 1, objective: "Index APIs", isCriticalPath: true,
      estimatedDurationHours: 12, acceptanceCriteria: ["APIs indexed"], studioTarget: "scribe",
      tasks: [{ id: "t1", title: "Index", isComplete: false, estimatedHours: 4 }],
      assignee: { type: "agent", name: "Sentinel", role: "Analyst" },
    },
    {
      id: "w2", name: "Sign-off", waveNumber: 2, objective: "Human approval", dependencies: ["w1"],
      assignee: { type: "human", name: "Ops Director", role: "Approver" },
      governance: { riskTier: "critical", requiresDualSignOff: true, smtInvariants: [] },
    },
  ],
});

const actor = { organizationId: 7, userId: "user-1", isOrgAdmin: true };

beforeEach(() => {
  h.existing = [];
  h.inserted = { cycle: null, blueprints: null };
  vi.clearAllMocks();
  h.getProject.mockImplementation(async (_ctx: any, id: number) => ({ id, key: `p${id}` }));
  h.assertCanEdit.mockResolvedValue(undefined);
  h.findSession.mockResolvedValue(null);
  h.findSessionById.mockResolvedValue(null);
});

describe("toRuntimeBlueprints", () => {
  it("turns a human wave into a pausing milestone instead of an AI mission", () => {
    const [agent, human] = toRuntimeBlueprints(plan.waves);
    expect(agent.type).toBe("mission");
    expect(human).toMatchObject({ type: "milestone", pauseAtMilestone: true });
  });

  it("translates wave-id dependencies into the blueprint names the runtime waits on", () => {
    const [, human] = toRuntimeBlueprints(plan.waves);
    expect(human.dependencies).toEqual([{ blueprintName: "Discovery", type: "finish_to_start" }]);
  });

  it("keeps everything the author entered, and invents no duration for an unestimated wave", () => {
    const [agent, human] = toRuntimeBlueprints(plan.waves);
    expect(agent).toMatchObject({ estimatedDuration: 12, timeUnit: "h" });
    expect(agent.config).toMatchObject({
      waveId: "w1", studioTarget: "scribe", acceptanceCriteria: ["APIs indexed"], workMode: "agent",
    });
    expect(agent.config.tasks).toHaveLength(1);
    expect(human).not.toHaveProperty("estimatedDuration");
    expect(human.config.estimate.source).toBe("unestimated");
    expect(human.config.governance?.riskTier).toBe("critical");
  });
});

describe("planFromCycle", () => {
  it("rebuilds the saved plan, mapping dependency names back to wave ids", () => {
    const restored = planFromCycle({
      name: plan.projectTitle,
      objective: plan.objective,
      budgetLimitUsd: "250.00",
      tokenLimit: plan.tokenLimit,
      executionPolicy: { maxParallelMissions: 3 },
      metadata: { targetSlaDays: 5, blueprints: toRuntimeBlueprints(plan.waves) },
    });
    expect(restored).toMatchObject({ projectTitle: "Incident remediation", budgetLimitUsd: 250, maxParallelMissions: 3, targetSlaDays: 5 });
    expect(restored!.waves.map((w) => ({ id: w.id, deps: w.dependencies, type: w.assignee.type }))).toEqual([
      { id: "w1", deps: [], type: "agent" },
      { id: "w2", deps: ["w1"], type: "human" },
    ]);
    expect(restored!.waves[0]).toMatchObject({ acceptanceCriteria: ["APIs indexed"], studioTarget: "scribe", estimatedDurationHours: 12 });
  });

  it("offers no plan for a cycle that was not saved from one", () => {
    expect(planFromCycle({ name: "Launch", metadata: { blueprints: [{ name: "A", objective: "x", config: {} }] } })).toBeNull();
    expect(planFromCycle({ name: "Empty", metadata: {} })).toBeNull();
  });
});

describe("planDigest", () => {
  it("ignores key order but not content or project", () => {
    const reverseKeys = (v: any): any =>
      Array.isArray(v) ? v.map(reverseKeys)
        : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)]))
        : v;
    const reordered = reverseKeys(plan);
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(plan));
    expect(planDigest(reordered, 3)).toBe(planDigest(plan, 3));
    expect(planDigest(plan, 4)).not.toBe(planDigest(plan, 3));
    expect(planDigest({ ...plan, budgetLimitUsd: 251 }, 3)).not.toBe(planDigest(plan, 3));
  });
});

describe("commitProjectPlan", () => {
  it("saves a pending_approval cycle and its blueprints, and spawns nothing", async () => {
    const result = await commitProjectPlan({ plan, idempotencyKey: "plan-key-0001" }, actor);

    expect(result).toMatchObject({ cycleId: 41, status: "pending_approval", replayed: false, blueprintCount: 2, projectId: null });
    expect(h.inserted.cycle).toMatchObject({
      status: "pending_approval",
      requiresApproval: 1,
      organizationId: 7,
      budgetLimitUsd: "250.00",
      executionPolicy: { maxParallelMissions: 3 },
    });
    expect(h.inserted.cycle.metadata.planCommit.key).toBe("plan-key-0001");
    expect(h.inserted.cycle.metadata.blueprints).toHaveLength(2);
    expect(h.inserted.blueprints.map((b: any) => b.type)).toEqual(["mission", "milestone"]);
    expect(h.emit).toHaveBeenCalledWith("cycle.created", 41, 7, expect.objectContaining({ status: "pending_approval" }));
  });

  it("uses the CREW room's project and checks edit rights on it", async () => {
    h.findSession.mockResolvedValue({ id: 1, projectId: 12 });
    const result = await commitProjectPlan({ plan, idempotencyKey: "plan-key-0002", sessionKey: "room-a" }, actor);
    expect(h.findSession).toHaveBeenCalledWith(7, "room-a");
    expect(h.assertCanEdit).toHaveBeenCalled();
    expect(result.projectId).toBe(12);
  });

  it("resolves the room by the numeric id the studio rail holds", async () => {
    h.findSessionById.mockResolvedValue({ id: 9, projectId: 13 });
    const result = await commitProjectPlan({ plan, idempotencyKey: "plan-key-0010", crewSessionId: 9 }, actor);
    expect(h.findSessionById).toHaveBeenCalledWith(7, 9);
    expect(result.projectId).toBe(13);
  });

  it("falls back to the active project only when neither room nor request names one", async () => {
    const fallback = await commitProjectPlan({ plan, idempotencyKey: "plan-key-0011", fallbackProjectId: 20 }, actor);
    expect(fallback.projectId).toBe(20);

    h.findSessionById.mockResolvedValue({ id: 9, projectId: 13 });
    const room = await commitProjectPlan({ plan, idempotencyKey: "plan-key-0012", crewSessionId: 9, fallbackProjectId: 20 }, actor);
    expect(room.projectId).toBe(13);

    const explicit = await commitProjectPlan({ plan, idempotencyKey: "plan-key-0013", projectId: 21, fallbackProjectId: 20 }, actor);
    expect(explicit.projectId).toBe(21);
  });

  it("refuses a request naming a different project than its room", async () => {
    h.findSession.mockResolvedValue({ id: 1, projectId: 12 });
    await expect(commitProjectPlan({ plan, idempotencyKey: "plan-key-0003", sessionKey: "room-a", projectId: 99 }, actor))
      .rejects.toMatchObject({ statusCode: 400, code: "PROJECT_MISMATCH" });
    expect(h.inserted.cycle).toBeNull();
  });

  it("writes nothing when the project is unreadable or read-only for the caller", async () => {
    h.getProject.mockRejectedValueOnce(Object.assign(new Error("not found"), { statusCode: 404 }));
    await expect(commitProjectPlan({ plan, idempotencyKey: "plan-key-0004", projectId: 5 }, actor)).rejects.toMatchObject({ statusCode: 404 });

    h.assertCanEdit.mockRejectedValueOnce(Object.assign(new Error("editor required"), { statusCode: 403 }));
    await expect(commitProjectPlan({ plan, idempotencyKey: "plan-key-0005", projectId: 5 }, actor)).rejects.toMatchObject({ statusCode: 403 });
    expect(h.inserted.cycle).toBeNull();
  });

  it("refuses a plan with no project to a caller who is not an org admin", async () => {
    await expect(commitProjectPlan({ plan, idempotencyKey: "plan-key-0020" }, { organizationId: 7, userId: "member" }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(h.inserted.cycle).toBeNull();
  });

  it("rejects a cyclic plan before touching the database", async () => {
    const cyclic = { ...plan, waves: [{ ...plan.waves[0], dependencies: ["w2"] }, plan.waves[1]] };
    await expect(commitProjectPlan({ plan: cyclic, idempotencyKey: "plan-key-0006" }, actor))
      .rejects.toMatchObject({ statusCode: 400, code: "INVALID_PLAN" });
    expect(h.inserted.cycle).toBeNull();
  });

  it("returns the existing cycle when the same key and plan are retried", async () => {
    h.existing = [{
      id: 30, name: plan.projectTitle, status: "pending_approval", projectId: null, blueprintCount: 2,
      metadata: { planCommit: { key: "plan-key-0007", digest: planDigest(plan, null) } },
    }];
    const result = await commitProjectPlan({ plan, idempotencyKey: "plan-key-0007" }, actor);
    expect(result).toMatchObject({ cycleId: 30, replayed: true });
    expect(h.inserted.cycle).toBeNull();
    expect(h.emit).not.toHaveBeenCalled();
  });

  it("refuses to replay a key that saved a different plan", async () => {
    h.existing = [{ id: 30, metadata: { planCommit: { key: "plan-key-0008", digest: "something-else" } } }];
    await expect(commitProjectPlan({ plan, idempotencyKey: "plan-key-0008" }, actor))
      .rejects.toMatchObject({ statusCode: 409, details: { code: "IDEMPOTENCY_KEY_REUSED", cycleId: 30 } });
    expect(h.inserted.cycle).toBeNull();
  });
});
