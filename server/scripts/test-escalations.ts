import "dotenv/config";
import { db } from "@server/database_service.js";
import { missionRuns, missions, operationalCycles, cycleBlueprints, missionTemplates } from "@shared/schema/index.js";
import { eq, and, desc } from "drizzle-orm";
import { EscalationService } from "../domain/mission/core/escalation.service.js";

async function main() {
  console.log("=== STARTING ESCALATIONS E2E TEST ===");

  // 1. Fetch the latest Operational Cycle
  const [cycle] = await db.select().from(operationalCycles).orderBy(desc(operationalCycles.createdAt)).limit(1);
  if (!cycle) {
    console.error("No operational cycle found. Run seed script first!");
    process.exit(1);
  }
  console.log(`Using Cycle: ${cycle.name} (ID: ${cycle.id})`);

  // 2. Fetch the UAT and Dev mission templates
  const [uatTemplate] = await db.select().from(missionTemplates).where(eq(missionTemplates.name, "Release Candidate & UAT")).limit(1);
  const [devTemplate] = await db.select().from(missionTemplates).where(eq(missionTemplates.name, "Core Application Development")).limit(1);

  if (!uatTemplate || !devTemplate) {
    console.error("UAT or Dev template not found in database.");
    process.exit(1);
  }

  // Create UAT mission andDev mission records if not existing in cycle context
  const [uatMission] = await db.insert(missions).values({
    name: uatTemplate.name,
    objective: uatTemplate.description,
    organizationId: cycle.organizationId,
    createdBy: cycle.createdBy,
    status: "active",
    executionStrategy: "pre_planned"
  }).returning();

  // 3. Create a mock stalled UAT mission run
  console.log("Inserting mock stalled UAT run...");
  const [run] = await db.insert(missionRuns).values({
    missionId: uatMission.id,
    organizationId: cycle.organizationId,
    name: "Mock Run: Release Candidate & UAT",
    status: "waiting_on_human",
    createdBy: cycle.createdBy,
    cycleId: cycle.id,
    missionContext: {},
  }).returning();

  console.log(`Stalled Run Created. ID: ${run.id}`);

  // 4. Update the run's updatedAt to 2.5 minutes ago to simulate timeout
  const pastDate = new Date(Date.now() - 2.5 * 60 * 1000);
  await db.update(missionRuns)
    .set({ updatedAt: pastDate })
    .where(eq(missionRuns.id, run.id));
  
  console.log(`Updated run #${run.id} updatedAt to simulated past time: ${pastDate.toISOString()}`);

  // 5. Run the EscalationService check
  console.log("Running EscalationService.checkEscalations()...");
  await EscalationService.checkEscalations();

  // Yield to allow async operations/spawns to complete
  await new Promise(r => setTimeout(r, 2000));

  // 6. Verify Results
  console.log("\n--- VERIFYING DATABASE STATE ---");
  const [updatedRun] = await db.select().from(missionRuns).where(eq(missionRuns.id, run.id)).limit(1);

  if (!updatedRun) {
    console.error("Run not found after check!");
    process.exit(1);
  }

  console.log(`Original Run Status: ${updatedRun.status}`);
  console.log(`Original Run Failure Reason: ${updatedRun.failureReason}`);
  const escalationState = (updatedRun.missionContext as any)?.escalationState;
  console.log("Escalation State inside missionContext:", JSON.stringify(escalationState, null, 2));

  // Check if target Dev mission was spawned
  const newRuns = await db.select()
    .from(missionRuns)
    .where(and(
      eq(missionRuns.cycleId, cycle.id),
      eq(missionRuns.name, "Core Application Development")
    ))
    .orderBy(desc(missionRuns.createdAt));

  console.log(`\nSpawned Dev Runs matching name: ${newRuns.length}`);
  if (newRuns.length > 0) {
    console.log(`Latest Spawned Run ID: ${newRuns[0].id}, Status: ${newRuns[0].status}`);
  }

  // Evaluate success criteria
  const isWarningOk = escalationState?.warningTriggered === true;
  const isCriticalOk = escalationState?.criticalTriggered === true;
  const isStatusOk = updatedRun.status === "failed";
  const isSpawnOk = newRuns.length > 0;

  if (isWarningOk && isCriticalOk && isStatusOk && isSpawnOk) {
    console.log("\n✅ E2E ESCALATION TEST PASSED SUCCESSFULLY!");
  } else {
    console.error("\n❌ E2E ESCALATION TEST FAILED!");
    console.error({ isWarningOk, isCriticalOk, isStatusOk, isSpawnOk });
    process.exit(1);
  }

  // Cleanup mock run and spawned run to keep database clean
  console.log("\nCleaning up mock data...");
  await db.delete(missionRuns).where(eq(missionRuns.id, run.id));
  if (newRuns.length > 0) {
    await db.delete(missionRuns).where(eq(missionRuns.id, newRuns[0].id));
  }
  await db.delete(missions).where(eq(missions.id, uatMission.id));

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
