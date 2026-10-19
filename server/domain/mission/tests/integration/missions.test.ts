/**
 * Missions Service Integration Tests
 * Aligned with docs/specs/MISSIONS_SPEC.md
 * Tests mission service with real database (no HTTP layer).
 * Requires migrations applied (db:migrate) and missions table to exist.
 */

/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@server/database_service.js";
import { missions, missionRuns, missionBlackboardHistory } from "@shared/schema/index.js";
import { pipelines as pipelinesTable } from "@shared/schema/pipelines/pipeline-core.js";
import { eq, sql, and, isNull, inArray } from "drizzle-orm";

// Skip if missions table doesn't exist (migrations not run)
async function missionsTableExists(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1 FROM missions LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

const shouldRunMissionsIntegration = await missionsTableExists();

describe("Missions Service Integration", () => {
  let missionId: number;
  let missionRunId: number;
  let missionService: any;
  let missionRunService: any;

  let p1: number;
  let p2: number;

  beforeAll(async () => {
    // Dynamic imports to avoid top-level circular dependency issues
    const mService = await import("@server/domain/mission/core/mission.service.js");
    const mrService = await import("@server/domain/mission/core/mission-run.service.js");
    missionService = mService.missionService;
    missionRunService = mrService.missionRunService;

    // 1. Create Pipelines for FKs
    // @ts-ignore
    const [pipe1] = (await db.insert(pipelinesTable as any).values([{ name: "Test P1", triggerType: "manual", createdBy: "test" }] as any).returning() as any);
    // @ts-ignore
    const [pipe2] = (await db.insert(pipelinesTable as any).values([{ name: "Test P2", triggerType: "manual", createdBy: "test" }] as any).returning() as any);
    p1 = pipe1!.id;
    p2 = pipe2!.id;

    // @ts-ignore
    const [m] = (await db
      .insert(missions as any)
      .values([{
        name: "Test Mission Parent",
        type: "mission_based",
        createdBy: "test_missions",
        blackboard: {},
      }] as any)
      .returning() as any);
    missionId = m!.id;
  });

  afterAll(async () => {
    if (missionRunId) await db.delete(missionRuns).where(eq(missionRuns.id, missionRunId));
    if (missionId) {
      await db.delete(missionBlackboardHistory).where(eq(missionBlackboardHistory.missionId, missionId));
      await db.delete(missions).where(eq(missions.id, missionId));
    }
    await db.delete(pipelinesTable).where(inArray(pipelinesTable.id, [p1, p2]));
  });

  describe("create", () => {
    it("should create a mission run", async () => {
      const run = await missionRunService.create({
        missionId,
        name: "Integration Test Mission Run",
        pipelineSequence: [p1, p2],
        createdBy: "test_missions",
      });

      expect(run).toHaveProperty("id");
      expect(run.name).toBe("Integration Test Mission Run");
      expect(run.status).toBe("active");
      expect(run.missionId).toBe(missionId);
      expect(run.pipelineSequence).toEqual([p1, p2]);
      missionRunId = run.id;
    });
  });

  describe("list", () => {
    it("should list mission runs by missionId", async () => {
      const list = await missionRunService.list({ missionId });

      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBeGreaterThanOrEqual(1);
      const run = list.find((m: any) => m.id === missionRunId);
      expect(run).toBeDefined();
    });
  });

  describe("getById", () => {
    it("should get mission run by id", async () => {
      const run = await missionRunService.getById(missionRunId);

      expect(run).toBeDefined();
      expect(run!.id).toBe(missionRunId);
      expect(run!.name).toBe("Integration Test Mission Run");
    });

    it("should return null for unknown mission run", async () => {
      const run = await missionRunService.getById(999999);
      expect(run).toBeNull();
    });
  });

  describe("checkpoint", () => {
    it("should checkpoint mission run and persist to blackboard history", async () => {
      await missionRunService.checkpoint({
        missionRunId,
        missionId,
        missionContext: { step1_output: "data" },
        reason: "checkpoint:milestone_complete",
        changedBy: "agent:1",
      });

      const run = await missionRunService.getById(missionRunId);
      expect((run!.missionContext as Record<string, unknown>).step1_output).toBe("data");
    });
  });

  describe("getCheckpoints", () => {
    it("should return checkpoint history", async () => {
      const checkpoints = await missionRunService.getCheckpoints(missionRunId, 10);

      expect(Array.isArray(checkpoints)).toBe(true);
      expect(checkpoints.length).toBeGreaterThanOrEqual(1);
      expect(checkpoints.some((c: any) => c.changeReason === "checkpoint:milestone_complete")).toBe(true);
    });
  });

  describe("update", () => {
    it("should update mission run context", async () => {
      const updated = await missionRunService.update(missionRunId, { missionContext: { key: "value" } });

      expect(updated.missionContext).toHaveProperty("key", "value");
    });
  });

  describe("clearResumeAndSetActive", () => {
    it("should pause for file and resume", async () => {
      // Mock pipeline execution ID and step ID for the pause
      await missionRunService.pauseForFile(missionRunId, "/tmp", "*.csv", 1, 0);

      let run = await missionRunService.getById(missionRunId);
      expect(run!.status).toBe("waiting_on_file");

      await missionRunService.clearResumeAndSetActive(missionRunId);

      run = await missionRunService.getById(missionRunId);
      expect(run!.status).toBe("active");
    });
  });

  describe("Soft Delete Persistence", () => {
    it("should perform a soft-delete on a mission", async () => {
      // 1. Delete the mission
      await missionService.deleteMission(missionId, "test_user");

      // 2. Verify it is gone from the standard list
      const list = await missionService.listMissions(1);
      expect(list.find((m: any) => m.id === missionId)).toBeUndefined();

      // 3. Verify it still exists in the DB with a deleted_at timestamp
      const [dbRecord] = await db.select().from(missions).where(eq(missions.id, missionId));
      expect(dbRecord).toBeDefined();
      expect(dbRecord.deletedAt).toBeInstanceOf(Date);
    });

    it("should exclude soft-deleted runs from the run list", async () => {
        // Create a run, delete it, then check list
        const run = await missionRunService.create({
            missionId,
            name: "Delete Me Run",
            pipelineSequence: [p1],
            createdBy: "test"
        });

        // Use the internal delete if available, or just update the DB directly to test filtering
        await db.update(missionRuns).set({ deletedAt: new Date() }).where(eq(missionRuns.id, run.id));

        const list = await missionRunService.list({ missionId });
        expect(list.find((r: any) => r.id === run.id)).toBeUndefined();
    });
  });
});
