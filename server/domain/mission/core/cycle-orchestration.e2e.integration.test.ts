/**
 * Orchestration E2E (integration) — drives the REAL CycleManagerService against a
 * real Postgres, with mission *execution* simulated (no agents/LLM) so the test
 * exercises the actual orchestration code paths end-to-end:
 *
 *   - wave / dependency order via the concurrency dispatcher (#1)
 *   - execution-plan + critical-path persistence (#5)
 *   - data-flow contract violation → audit log (#4)
 *   - graduated gate escalation + expiry on the real gateway (#3)
 *
 * Mission execution is stubbed: spawnMissionForCycle inserts a completed
 * missionRun, waitForMissionRunCompletion resolves instantly. Everything else
 * (planning, dispatch, dataflow resolution, gateway, persistence) is real.
 *
 * Requires DATABASE_URL. Creates a throwaway org and cleans it up afterwards.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@server/database_service.js";
import {
  orgs, operationalCycles, cycleBlueprints, cycleDependencyGates,
  cycleStrategicAudits, missions, missionRuns,
} from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { CycleManagerService } from "./cycle-manager.service.js";
import { cycleDependencyGatewayService } from "./cycle-dependency-gateway.service.js";

const DAY = 86_400_000;

let orgId: number;
let cycleId: number;
const missionIdByName: Record<string, number> = {};

// Runtime blueprints: A → B → C (linear). B declares an output it won't produce;
// C pulls it → expect a data-flow contract violation when C resolves its inputs.
const blueprints = [
  { name: "A", type: "mission", dependencies: [], estimatedDays: 1, config: {} },
  { name: "B", type: "mission", dependencies: [{ blueprintName: "A", type: "finish_to_start" }], estimatedDays: 2, outputs: { plan: "array" }, config: {} },
  { name: "C", type: "mission", dependencies: [{ blueprintName: "B", type: "finish_to_start" }], estimatedDays: 1, dataFlows: [{ sourceBlueprint: "B", sourceOutputKey: "plan", targetInputKey: "plan" }], config: {} },
];

beforeAll(async () => {
  const [org] = await db.insert(orgs).values({ name: `E2E_ORCH_${Date.now()}` }).returning();
  orgId = org.id;

  for (const name of ["A", "B", "C"]) {
    const [m] = await db.insert(missions).values({
      name, objective: name, organizationId: orgId, createdBy: "e2e", status: "draft",
    }).returning();
    missionIdByName[name] = m.id;
  }

  const [cycle] = await db.insert(operationalCycles).values({
    name: `E2E Cycle ${Date.now()}`, objective: "e2e orchestration", organizationId: orgId,
    createdBy: "e2e", status: "active",
  }).returning();
  cycleId = cycle.id;

  await db.insert(cycleBlueprints).values(
    blueprints.map((b) => ({
      cycleId, name: b.name, objective: b.name, type: "mission",
      estimatedDays: b.estimatedDays, dependencies: b.dependencies as any, config: {},
    }))
  );
});

afterAll(async () => {
  if (orgId) {
    await db.delete(missionRuns).where(eq(missionRuns.organizationId, orgId)).catch(() => {});
    await db.delete(missions).where(eq(missions.organizationId, orgId)).catch(() => {});
    await db.delete(operationalCycles).where(eq(operationalCycles.organizationId, orgId)).catch(() => {});
    await db.delete(orgs).where(eq(orgs.id, orgId)).catch(() => {});
  }
});

describe("cycle launch — dispatch order + CPM persistence + dataflow contract", () => {
  const dispatchOrder: string[] = [];
  const spies: any[] = [];

  beforeAll(async () => {
    // Simulate execution: record order, create a completed run (empty context → B
    // produces no "plan", triggering C's contract violation).
    spies.push(vi.spyOn(CycleManagerService as any, "spawnMissionForCycle").mockImplementation(
      async (...args: any[]) => {
        const bp = args[1];
        dispatchOrder.push(bp.name);
        const [run] = await db.insert(missionRuns).values({
          name: bp.name, missionId: missionIdByName[bp.name], cycleId, organizationId: orgId,
          createdBy: "e2e", status: "completed", missionContext: {},
        }).returning();
        return { missionRunId: run.id };
      }
    ));
    spies.push(vi.spyOn(CycleManagerService as any, "waitForMissionRunCompletion").mockResolvedValue("completed"));
    // Order is enforced by the dispatcher; mock the gateway wait to avoid the
    // listener-attach race in a fully in-process simulation.
    spies.push(vi.spyOn(cycleDependencyGatewayService, "waitForDependency").mockResolvedValue(undefined));

    await (CycleManagerService as any).spawnBlueprintsWithDeps(cycleId, blueprints, "e2e", orgId, 5);
  });

  afterAll(() => spies.forEach((s) => s.mockRestore()));

  it("dispatches blueprints in dependency (wave) order", () => {
    expect(dispatchOrder).toEqual(["A", "B", "C"]);
  });

  it("persists the execution plan (waves + critical path) on the cycle", async () => {
    const [c] = await db.select().from(operationalCycles).where(eq(operationalCycles.id, cycleId));
    const plan = c.executionPlan as any;
    expect(plan).toBeTruthy();
    expect(plan.waves).toEqual([["A"], ["B"], ["C"]]);
    expect(plan.criticalPath).toEqual(["A", "B", "C"]);
    expect(plan.projectDurationMs).toBe((1 + 2 + 1) * DAY);
    expect(plan.nodes.B.onCriticalPath).toBe(true);
  });

  it("denormalizes wave index + critical-path flag onto blueprints", async () => {
    const rows = await db.select().from(cycleBlueprints).where(eq(cycleBlueprints.cycleId, cycleId));
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName.A.waveIndex).toBe(0);
    expect(byName.B.waveIndex).toBe(1);
    expect(byName.C.waveIndex).toBe(2);
    expect(byName.A.onCriticalPath).toBe(true);
    expect(byName.C.onCriticalPath).toBe(true);
  });

  it("records a data-flow contract violation when the source omits its declared output", async () => {
    const audits = await db.select().from(cycleStrategicAudits).where(eq(cycleStrategicAudits.cycleId, cycleId));
    const violation = audits.find((a) => (a.metadata as any)?.type === "dataflow_violation");
    expect(violation).toBeTruthy();
    expect((violation!.metadata as any).sourceBlueprint).toBe("B");
    expect((violation!.metadata as any).sourceOutputKey).toBe("plan");
    expect((violation!.metadata as any).targetBlueprint).toBe("C");
  });
});

describe("gate escalation — real gateway against the DB", () => {
  it("escalates (warn→alert→escalated) and expires a real gate, persisting state", async () => {
    // No upstream run exists → the gate waits and times out.
    await cycleDependencyGatewayService.waitForDependency(
      cycleId, "NEVER_UP", "NEVER_DOWN", "finish_to_start", 0, "plus",
      { timeoutMs: 150, onTimeout: "continue", organizationId: orgId, escalateTo: "scrum-master" }
    );

    const [gate] = await db.select().from(cycleDependencyGates).where(and(
      eq(cycleDependencyGates.cycleId, cycleId),
      eq(cycleDependencyGates.downstreamBlueprintName, "NEVER_DOWN"),
    ));
    expect(gate).toBeTruthy();
    expect(gate.status).toBe("expired");
    expect(gate.escalationState).toBe("escalated");
    expect(gate.escalatedTo).toBe("scrum-master");
    expect(gate.timeoutMs).toBe(150);
  });
});
