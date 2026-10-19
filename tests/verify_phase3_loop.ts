import { db } from "../server/db/index.js";
import { missionRunService } from "../server/domain/mission/core/mission-run.service.js";
import { approvalService } from "../server/domain/integrations/core/approval.service.js";
import { missionShadowRuns, missionRuns, missions } from "../shared/schema/missions.js";
import { approvalRequests } from "../shared/schema/index.js";
import { desc, eq } from "drizzle-orm";
import { orgs, users } from "../shared/schema/auth.js";

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function verifyPhase3Loop() {
  console.log("--- PHASE 3: AUTONOMOUS LOOP VERIFICATION ---");

  // 0. Fetch a valid Organization and User
  const [org] = await db.select().from(orgs).limit(1);
  const [user] = await db.select().from(users).limit(1);
  const orgId = org?.id || 1;
  const userId = user?.id || "1";

  // 1. Create a Primary Mission Run for testing
  const [mission] = await db.insert(missions).values({
    name: "Recursive Improvement Test",
    organizationId: orgId,
    createdBy: userId,
    objective: "Generate a high-quality summary of AI trends.",
    isShadowMode: true,
  }).returning();

  const [primaryRun] = await db.insert(missionRuns).values({
    missionId: mission.id,
    organizationId: orgId,
    name: "Primary Baseline",
    status: "completed",
    missionContext: { result: "AI is growing fast in 2024." },
    createdBy: userId,
  }).returning();

  // 2. Create an Improved Shadow Run
  console.log("Creating shadow run...");
  const [shadow] = await db.insert(missionShadowRuns).values({
    parentRunId: primaryRun.id,
    modelId: "gemini-1.5-pro",
    promptVersion: "v2-experimental",
    status: "active",
    missionContext: { result: "Analysis of 2024 AI Trends: Generative AI has reached mass adoption, with a shift toward agentic workflows and multi-modal integration. Efficiency has increased by 40%. This is significantly better than the baseline." },
  }).returning();

  // 3. Mark Shadow as Completed (This should trigger the Phase 3 Evaluation Loop)
  console.log("Completing shadow run (Triggering Judge Model)...");
  await missionRunService.shadowCheckpoint(shadow.id, { status: "completed" });

  // 4. Wait for autonomous evaluation (it runs in a deferred promise)
  console.log("Waiting for Judge Model and Optimization Proposal (15s)...");
  await sleep(15000);

  // 5. Check for HIL Proposal in the approvalRequests table
  const [proposal] = await db
    .select()
    .from(approvalRequests)
    .where(eq(approvalRequests.executionId, `optimization:${shadow.id}`))
    .orderBy(desc(approvalRequests.createdAt))
    .limit(1);

  if (!proposal) {
    console.log("FAILURE: No optimization proposal found in Decision Inbox.");
    process.exit(1);
  }

  console.log("Success: Optimization Proposal detected in Inbox!");
  const context = proposal.modifiedOutput as any;
  console.log(`Judge Score: ${context?.score}/100`);
  console.log(`Reasoning: ${context?.reasoning}`);

  // 6. Simulate Human Approval via the Approval Service
  console.log("Simulating Human Approval of the Optimization Proposal...");
  await approvalService.processDecision(proposal.id, {
    decision: 'approved',
    comments: "I approve this automated optimization."
  }, userId, primaryRun.createdBy as string); // Match email to creator for security check

  // 7. Verify Promotion: Check if the Mission configuration was updated
  const [finalMission] = await db
    .select()
    .from(missions)
    .where(eq(missions.id, mission.id))
    .limit(1);

  const blackboard = finalMission.blackboard as any;
  if (blackboard.primaryModelId === shadow.modelId && finalMission.isShadowMode === false) {
    console.log("SUCCESS: Shadow configuration promoted to Primary via HIL Loop!");
    console.log(`Current Primary Model: ${blackboard.primaryModelId}`);
  } else {
    console.log("FAILURE: Mission was not updated correctly after approval.");
    console.log("Final Mission State:", JSON.stringify(finalMission, null, 2));
    process.exit(1);
  }
}

verifyPhase3Loop().then(() => {
  console.log("--- PHASE 3 VERIFICATION COMPLETE ---");
  process.exit(0);
}).catch(err => {
  console.error("Verification failed:", err);
  process.exit(1);
});
