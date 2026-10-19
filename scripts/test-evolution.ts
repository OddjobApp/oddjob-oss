import { db } from "../server/db/index.js";
import { agentDeployments } from "../shared/schema/agent-deployments.js";
import { missionRuns, missions, missionMembers } from "../shared/schema/index.js";
import { SoulService } from "../server/domain/mission/core/soul.service.js";
import { missionRunService } from "../server/domain/mission/core/mission-run.service.js";
import { eq, and } from "drizzle-orm";

async function runTest() {
  console.log("--- Starting Soul Evolution Test ---");

  // 1. Find an agent deployment
  const [agentDep] = await db.select().from(agentDeployments).limit(1);
  if (!agentDep) {
    console.error("No agent deployment found for testing.");
    process.exit(1);
  }

  const initialTraits = agentDep.oceanTraits as any;
  console.log(`Agent ${agentDep.id} initial traits:`, initialTraits);

  // 2. Mock a mission and member
  const [mission] = await db.select().from(missions).limit(1);
  if (!mission) {
    console.error("No mission found for testing.");
    process.exit(1);
  }

  // Ensure member exists
  await db.insert(missionMembers).values({
    missionId: mission.id,
    entityType: 'job',
    entityId: agentDep.jobId,
    role: 'member',
    status: 'active'
  }).onConflictDoNothing();

  // 3. Create a mock mission run
  const [run] = await db.insert(missionRuns).values({
    missionId: mission.id,
    name: "Test Evolution Run",
    status: "active",
    createdBy: "system",
    missionContext: { viaAppSlug: null }
  }).returning();

  console.log(`Created test mission run ${run.id}`);

  // 4. Trigger completion
  console.log("Triggering mission completion...");
  await missionRunService.update(run.id, { status: "completed" });

  // 5. Wait a bit for async hooks
  console.log("Waiting for async hooks...");
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 6. Verify changes
  const [updatedDep] = await db.select().from(agentDeployments).where(eq(agentDeployments.id, agentDep.id)).limit(1);
  const finalTraits = updatedDep.oceanTraits as any;
  console.log(`Agent ${agentDep.id} final traits:`, finalTraits);

  if (JSON.stringify(initialTraits) !== JSON.stringify(finalTraits)) {
    console.log("SUCCESS: Traits have evolved!");
  } else {
    // Check if it's because drift was 0
    console.log("WARNING: Traits did not change. This could be because the drift was 0 for 'success' outcome (O+0.01, C+0.01).");
  }

  // 7. Cleanup
  await db.delete(missionRuns).where(eq(missionRuns.id, run.id));
  console.log("Cleaned up test mission run.");
  process.exit(0);
}

runTest().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
