/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@shared/schema/index.js";
import { requireTestDatabaseUrl } from "../configure-test-environment.js";

vi.mock("@domain/core/infrastructure/redis/redis-client.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  redis: { get: vi.fn(), set: vi.fn(), on: vi.fn(), publish: vi.fn(async () => 0) },
  redisManager: { isReady: () => true },
  getRedisOptions: () => ({ host: "127.0.0.1", port: 6379 }),
}));

/**
 * Found live on 2026-09-27: after approving a plan-commit cycle, its first
 * mission failed, self-healing synthesized "Remediation: …", and that kept
 * happening after the cycle was PAUSED and after the run was TERMINATED — each
 * stop counted as a failure to repair. The spawn chain lives in memory and never
 * re-read the cycle. These run the real chain against Postgres, stubbing only
 * the mission launch and the model call that writes the remedial blueprint.
 */
describe("cycle self-healing respects operator stops (Postgres)", () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let CycleManagerService: typeof import("@domain/mission/core/cycle-manager.service.js").CycleManagerService;
  let orgId: number;
  const cycleIds: number[] = [];
  const runIds: number[] = [];
  const suffix = Date.now();

  async function makeCycle(status = "active") {
    const [cycle] = await db.insert(schema.operationalCycles).values({
      organizationId: orgId, name: `Heal ${suffix}-${cycleIds.length}`, objective: "guard", status, createdBy: "test",
    } as any).returning();
    cycleIds.push(cycle.id);
    return cycle.id as number;
  }

  async function makeRun(cycleId: number, status: string) {
    const [run] = await db.insert(schema.missionRuns).values({
      organizationId: orgId, cycleId, name: "Collect", status, createdBy: "test",
    } as any).returning();
    runIds.push(run.id);
    return run.id as number;
  }

  /** Launch returns a run already in `finalStatus`; `duringWait` runs while "executing". */
  function stubLaunch(runId: number, duringWait?: () => Promise<void>) {
    const launch = vi.spyOn(CycleManagerService, "spawnMissionForCycle").mockResolvedValue({ missionRunId: runId } as any);
    vi.spyOn(CycleManagerService, "waitForMissionRunCompletion").mockImplementation(async () => {
      await duringWait?.();
      return "done";
    });
    const heal = vi.spyOn(CycleManagerService, "synthesizeRemedialBlueprint").mockResolvedValue(null as any);
    return { launch, heal };
  }

  const run = (cycleId: number) =>
    CycleManagerService.spawnBlueprintsWithDeps(cycleId, [{ name: "Collect", objective: "x", type: "mission", dependencies: [] }], "test", orgId, 5);

  beforeAll(async () => {
    pool = new Pool({ connectionString: requireTestDatabaseUrl(), max: 5 });
    db = drizzle(pool, { schema });
    const [org] = await db.insert(schema.orgs).values({ name: `Heal Guard Org ${suffix}` } as any).returning();
    orgId = org.id;
    ({ CycleManagerService } = await import("@domain/mission/core/cycle-manager.service.js"));
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    if (runIds.length) await db.delete(schema.missionRuns).where(inArray(schema.missionRuns.id, runIds));
    if (cycleIds.length) {
      await db.delete(schema.cycleBlueprints).where(inArray(schema.cycleBlueprints.cycleId, cycleIds));
      await db.delete(schema.operationalCycles).where(inArray(schema.operationalCycles.id, cycleIds));
    }
    await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId));
    await pool.end();
  });

  it("still self-heals a genuine failure in an active cycle", async () => {
    const cycleId = await makeCycle();
    const { heal } = stubLaunch(await makeRun(cycleId, "failed"));
    await run(cycleId);
    expect(heal).toHaveBeenCalledTimes(1);
  });

  it("does not remediate a run an operator cancelled", async () => {
    const cycleId = await makeCycle();
    const { heal } = stubLaunch(await makeRun(cycleId, "cancelled"));
    await run(cycleId);
    expect(heal).not.toHaveBeenCalled();
  });

  it("does not remediate once the cycle is paused", async () => {
    const cycleId = await makeCycle();
    const { heal } = stubLaunch(await makeRun(cycleId, "failed"), async () => {
      await db.update(schema.operationalCycles).set({ status: "paused" } as any).where(eq(schema.operationalCycles.id, cycleId));
    });
    await run(cycleId);
    expect(heal).not.toHaveBeenCalled();
  });

  it("launches nothing into a cancelled cycle", async () => {
    const cycleId = await makeCycle("cancelled");
    const { launch, heal } = stubLaunch(await makeRun(cycleId, "failed"));
    await run(cycleId);
    expect(launch).not.toHaveBeenCalled();
    expect(heal).not.toHaveBeenCalled();
  });
});
