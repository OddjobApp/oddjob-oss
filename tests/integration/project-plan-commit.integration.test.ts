/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@shared/schema/index.js";
import { requireTestDatabaseUrl } from "../configure-test-environment.js";

/**
 * What the unit test's fake transaction cannot show: that the advisory lock and
 * the metadata->planCommit->key lookup really make a retry (or two concurrent
 * submits) produce ONE cycle, that the blueprints land with it, and that the
 * real Project Space gate refuses a private project to a non-member.
 */

// Notifications are best-effort side effects; keep them off Redis/Kafka here.
vi.mock("@domain/mission/core/cycle-manager.service.js", () => ({ emitCycleEvent: vi.fn() }));
vi.mock("@server/utils/cache-utils.js", () => ({ invalidateCachePattern: vi.fn(async () => undefined) }));
vi.mock("@domain/cache/cache.service.js", () => ({ cacheService: { invalidate: vi.fn(async () => undefined) } }));

describe("commitProjectPlan (Postgres)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let commitProjectPlan: typeof import("@domain/mission/core/project-plan-commit.service.js").commitProjectPlan;
  let orgId: number;
  let privateProjectId: number;
  const suffix = Date.now();

  const plan = {
    projectTitle: `Plan ${suffix}`,
    objective: "Integration",
    budgetLimitUsd: 50,
    tokenLimit: 1000,
    maxParallelMissions: 2,
    targetSlaDays: 2,
    waves: [
      { id: "a", name: "Build", waveNumber: 1, objective: "Build it", isCriticalPath: true, estimatedDurationHours: 4,
        dependencies: [], acceptanceCriteria: ["Built"], tasks: [], assignee: { type: "agent" as const, name: "A", role: "R" } },
      { id: "b", name: "Approve", waveNumber: 2, objective: "Sign off", isCriticalPath: false, estimatedDurationHours: 0,
        dependencies: ["a"], acceptanceCriteria: [], tasks: [], assignee: { type: "human" as const, name: "H", role: "Lead" } },
    ],
  };
  const admin = () => ({ organizationId: orgId, userId: `admin-${suffix}`, isOrgAdmin: true });

  beforeAll(async () => {
    pool = new Pool({ connectionString: requireTestDatabaseUrl(), max: 5 });
    db = drizzle(pool, { schema });
    const [org] = await db.insert(schema.orgs).values({ name: `Plan Commit Org ${suffix}` } as any).returning();
    orgId = org.id;
    const [project] = await db.insert(schema.projects).values({
      organizationId: orgId, key: `private-${suffix}`, name: "Private", visibility: "private", createdBy: "test",
    } as any).returning();
    privateProjectId = project.id;
    ({ commitProjectPlan } = await import("@domain/mission/core/project-plan-commit.service.js"));
  });

  afterAll(async () => {
    const cycles = await db.select({ id: schema.operationalCycles.id }).from(schema.operationalCycles)
      .where(eq(schema.operationalCycles.organizationId, orgId));
    if (cycles.length) {
      const ids = cycles.map(c => c.id);
      await db.delete(schema.cycleBlueprints).where(inArray(schema.cycleBlueprints.cycleId, ids));
      await db.delete(schema.operationalCycles).where(inArray(schema.operationalCycles.id, ids));
    }
    await db.delete(schema.projects).where(eq(schema.projects.id, privateProjectId));
    await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
    await pool.end();
  });

  it("persists a pending_approval cycle with blueprints that round-trip dependencies and bindings", async () => {
    const result = await commitProjectPlan({ plan, idempotencyKey: `k1-${suffix}` }, admin());
    expect(result).toMatchObject({ status: "pending_approval", replayed: false, blueprintCount: 2 });

    const [cycle] = await db.select().from(schema.operationalCycles).where(eq(schema.operationalCycles.id, result.cycleId));
    expect(cycle.status).toBe("pending_approval");
    expect((cycle.metadata as any).blueprints[1].dependencies).toEqual([{ blueprintName: "Build", type: "finish_to_start" }]);

    const rows = await db.select().from(schema.cycleBlueprints).where(eq(schema.cycleBlueprints.cycleId, result.cycleId));
    const byName = Object.fromEntries(rows.map(r => [r.name, r]));
    expect(byName.Build.type).toBe("mission");
    expect(byName.Approve.type).toBe("milestone");
    expect((byName.Build.config as any).acceptanceCriteria).toEqual(["Built"]);

    // Nothing ran: no mission runs exist for a cycle awaiting approval.
    const runs = await db.select().from(schema.missionRuns).where(eq(schema.missionRuns.cycleId, result.cycleId));
    expect(runs).toHaveLength(0);
  });

  it("returns one cycle for concurrent submits and retries of the same key", async () => {
    const key = `k2-${suffix}`;
    const results = await Promise.all([1, 2, 3].map(() => commitProjectPlan({ plan, idempotencyKey: key }, admin())));
    expect(new Set(results.map(r => r.cycleId)).size).toBe(1);
    expect(results.filter(r => !r.replayed)).toHaveLength(1);

    const retry = await commitProjectPlan({ plan, idempotencyKey: key }, admin());
    expect(retry).toMatchObject({ cycleId: results[0].cycleId, replayed: true });
  });

  it("refuses to reuse a key for a different plan", async () => {
    const key = `k3-${suffix}`;
    await commitProjectPlan({ plan, idempotencyKey: key }, admin());
    await expect(commitProjectPlan({ plan: { ...plan, objective: "Changed" }, idempotencyKey: key }, admin()))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it("hides a private project from a non-member and writes nothing", async () => {
    const before = await db.select().from(schema.operationalCycles).where(eq(schema.operationalCycles.organizationId, orgId));
    await expect(commitProjectPlan(
      { plan, idempotencyKey: `k4-${suffix}`, projectId: privateProjectId },
      { organizationId: orgId, userId: `outsider-${suffix}` },
    )).rejects.toMatchObject({ statusCode: 404 });
    const after = await db.select().from(schema.operationalCycles).where(eq(schema.operationalCycles.organizationId, orgId));
    expect(after).toHaveLength(before.length);
  });

  it("does not resolve another org's project", async () => {
    await expect(commitProjectPlan(
      { plan, idempotencyKey: `k5-${suffix}`, projectId: privateProjectId },
      { organizationId: orgId + 100000, userId: "x", isOrgAdmin: true },
    )).rejects.toMatchObject({ statusCode: 404 });
  });
});
