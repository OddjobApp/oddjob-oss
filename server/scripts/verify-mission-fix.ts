import "dotenv/config";
import { db } from "@server/database_service.js";
import { missionService } from "@domain/mission/core/mission.service.js";
import { missionRuns, missions } from "@shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function main() {
  console.log("--- Verifying Mission Fix ---");

  const testObjective = "Test mission to verify fix for orphaned runs. [Target Product: Test Report]";
  const userId = "user:test-fix";
  const orgId = 1;

  console.log("1. Creating mission...");
  const mission = await missionService.createMission({
    name: "Verification Mission",
    objective: testObjective,
    executionStrategy: "pre_planned",
    organizationId: orgId,
  }, userId);

  console.log(`Mission created: ID ${mission.id}`);

  // Check runs immediately after creation
  const runsAfterCreate = await db.select().from(missionRuns).where(eq(missionRuns.missionId, mission.id));
  console.log(`Runs after creation: ${runsAfterCreate.length} (Expected: 0)`);

  if (runsAfterCreate.length > 0) {
    console.error("FAIL: Mission run was created prematurely!");
  }

  console.log("2. Launching mission...");
  const launchResult = await missionService.launchMission(mission.id, userId, orgId);
  console.log("Launch Result:", JSON.stringify(launchResult, null, 2));

  // Check runs after launch
  const runsAfterLaunch = await db.select().from(missionRuns).where(eq(missionRuns.missionId, mission.id));
  console.log(`Runs after launch: ${runsAfterLaunch.length} (Expected: 1)`);

  for (const run of runsAfterLaunch) {
    console.log(`Run ID: ${run.id}, Status: ${run.status}, PipelineExecutionId: ${run.pipelineExecutionId}`);
  }

  if (runsAfterLaunch.length !== 1) {
    console.error(`FAIL: Expected 1 run, found ${runsAfterLaunch.length}`);
  }

  console.log("--- Verification Complete ---");
}

main().catch(err => {
  console.error("Verification failed:", err);
  process.exit(1);
});

