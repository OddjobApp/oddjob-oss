import { db } from "../server/db/index";
import { missionRunService } from "../server/domain/mission/core/mission-run.service";
import { missionShadowRuns, missions } from "../shared/schema/missions";
import { desc, eq } from "drizzle-orm";

async function verifyPromote() {
  console.log("--- PROMOTION VERIFICATION ---");
  
  // 1. Find the latest shadow run
  const [shadow] = await db
    .select()
    .from(missionShadowRuns)
    .orderBy(desc(missionShadowRuns.id))
    .limit(1);
    
  if (!shadow) {
    console.log("No shadow runs found to promote.");
    return;
  }
  
  console.log(`Found Shadow Run ID: ${shadow.id} for Model: ${shadow.modelId}`);
  
  // 2. Promote it
  console.log("Promoting to primary...");
  await missionRunService.promoteShadowRun(shadow.id);
  
  // 3. Verify mission configuration
  const parentRun = await missionRunService.getByIdOrThrow(shadow.parentRunId);
  const missionId = parentRun.missionId;
  
  const [mission] = await db
    .select()
    .from(missions)
    .where(eq(missions.id, missionId as number))
    .limit(1);
    
  if (!mission) throw new Error("Mission not found");
  
  console.log("Mission Blackboard:", JSON.stringify(mission.blackboard, null, 2));
  console.log("Is Shadow Mode:", mission.isShadowMode);
  
  const blackboard = mission.blackboard as any;
  if (blackboard.primaryModelId === shadow.modelId && mission.isShadowMode === false) {
    console.log("SUCCESS: Shadow run promoted and Shadow Mode deactivated.");
  } else {
    console.log("FAILURE: Promotion did not update mission correctly.");
  }
}

verifyPromote().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
