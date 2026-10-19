import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { missionRunService } from "@domain/mission/core/mission-run.service.js";
import { db, pool } from "@server/database_service.js";
import { missionRuns, missions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

describe("MissionRunService Integration", () => {
  let testMissionId: number;

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    try {
      // Setup a test mission
      const [mission] = await db.insert(missions).values({
        name: "Test Mission",
        objective: "Test Objective",
        reasoningProtocol: "hermes_xml",
        type: "collaborative",
        createdBy: "test_user",
        blackboard: {}
      }).returning();
      testMissionId = mission.id;
    } catch (err: any) {
      console.error("FAILED TO SETUP TEST MISSION:", err);
      // Log more details if it's a DB error
      if (err.detail) console.error("DB Error Detail:", err.detail);
      if (err.hint) console.error("DB Error Hint:", err.hint);
      throw err;
    }
  });

  it("should persist reasoningProtocol when creating a mission run", async () => {
    const run = await missionRunService.create({
      missionId: testMissionId,
      name: "Test Run",
      organizationId: 1,
      pipelineSequence: [],
      createdBy: "test_user",
      reasoningProtocol: "hermes_xml"
    });

    expect(run.reasoningProtocol).toBe("hermes_xml");

    // Verify in DB
    const [dbRun] = await db.select().from(missionRuns).where(eq(missionRuns.id, run.id)).limit(1);
    expect(dbRun.reasoningProtocol).toBe("hermes_xml");
  });

  it("should default to json_manifest if protocol not provided", async () => {
    const run = await missionRunService.create({
      missionId: testMissionId,
      name: "Default Run",
      pipelineSequence: [],
      createdBy: "test_user",
      organizationId: 1
    });

    expect(run.reasoningProtocol).toBe("json_manifest");
  });

  it("should retrieve mission runs with the correct protocol", async () => {
    await missionRunService.create({
      missionId: testMissionId,
      name: "Hermes Run",
      pipelineSequence: [],
      createdBy: "test_user",
      organizationId: 1,
      reasoningProtocol: "hermes_xml"
    });

    const runs = await missionRunService.list({ missionId: testMissionId });
    const hermesRun = runs.find((r: any) => r.name === "Hermes Run");
    expect(hermesRun?.reasoningProtocol).toBe("hermes_xml");
  });
});
