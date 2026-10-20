process.env.DISABLE_JOB_QUEUE = 'true';
process.env.REDIS_HOST = '127.0.0.1';
process.env.REDIS_PORT = '6379';
process.env.REDIS_URL = 'redis://127.0.0.1:6379';

/**
 * Mission Wake-Up Integration Tests
 * Aligned with docs/specs/MISSIONS_SPEC.md
 * Tests: file appears → mission run resumes; approval resolved → mission run resumes
 * Uses missions (parent) + missionRuns (execution) schema.
 */

/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { missionRunService } from "@domain/mission/core/mission-run.service.js";
import { db } from "@server/database_service.js";
import { missions, missionRuns, pipelines } from "@shared/schema/index.js";
import { eq, inArray, sql } from "drizzle-orm";

async function missionRunsTableExists(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1 FROM mission_runs LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

const shouldRun = await missionRunsTableExists();

describe.runIf(shouldRun)("Mission Wake-Up Integration", () => {
  let parentMissionId: number;
  let missionRunId: number;
  let pipelineIds: number[] = [];

  beforeAll(async () => {
    // Real pipelines for the run's sequence: it named ids 1 and 2, which existed only in
    // long-lived databases, so resuming the run failed current_pipeline_id's foreign key
    // on a fresh one, as in CI.
    pipelineIds = (await db
      .insert(pipelines)
      .values([1, 2].map((n) => ({ name: `wake-up-test-pipeline-${n}-${Date.now()}`, triggerType: "manual", createdBy: "test_wakeup" })))
      .returning({ id: pipelines.id })).map((p) => p.id);

    const [mission] = await db
      .insert(missions)
      .values({
        name: "Wake-Up Test Mission",
        type: "mission_based",
        createdBy: "test_wakeup",
        blackboard: {},
      })
      .returning();
    parentMissionId = mission!.id;

    const [run] = await db
      .insert(missionRuns)
      .values({
        missionId: parentMissionId,
        name: "Wake-Up Test Run",
        status: "active",
        pipelineSequence: pipelineIds,
        createdBy: "test_wakeup",
      })
      .returning();
    missionRunId = run!.id;
  });

  afterAll(async () => {
    if (missionRunId) await db.delete(missionRuns).where(eq(missionRuns.id, missionRunId));
    if (parentMissionId) await db.delete(missions).where(eq(missions.id, parentMissionId));
    if (pipelineIds.length) await db.delete(pipelines).where(inArray(pipelines.id, pipelineIds));
  });

  describe("file wake-up", () => {
    it("should pause for file and resume when resumeMissionRun called with matched path", async () => {
      await missionRunService.pauseForFile(missionRunId, "/uploads", "*.csv", 100, 2);

      let run = await missionRunService.getById(missionRunId);
      expect(run!.status).toBe("waiting_on_file");
      expect((run!.resumeCondition as any)?.type).toBe("file");
      expect((run!.resumeCondition as any)?.filePattern).toBe("*.csv");

      await missionRunService.resumeMissionRun(missionRunId, "/uploads/data.csv");

      run = await missionRunService.getById(missionRunId);
      expect(run!.status).toBe("active");
      expect(run!.resumeCondition).toBeNull();
    }, 60000);
  });

  describe("human approval wake-up", () => {
    it("should pause for human approval and resume when resumeIfWaitingOnApproval called", async () => {
      await missionRunService.pauseForHumanApproval(missionRunId, [999, 1000]);

      let run = await missionRunService.getById(missionRunId);
      expect(run!.status).toBe("waiting_on_human");
      expect((run!.resumeCondition as any)?.approvalRequestIds).toContain(999);

      await missionRunService.resumeIfWaitingOnApproval(999);

      run = await missionRunService.getById(missionRunId);
      expect(run!.status).toBe("active");
      expect(run!.resumeCondition).toBeNull();
    }, 60000);
  });

  describe("listWaitingOnFile", () => {
    it("should list mission runs waiting on file", async () => {
      await missionRunService.pauseForFile(missionRunId, "/tmp", "*.pdf", 101, 3);
      const waiting = await missionRunService.listWaitingOnFile();
      expect(waiting.some((m) => m.id === missionRunId)).toBe(true);

      await missionRunService.clearResumeAndSetActive(missionRunId);
    });
  });
});
