import { db } from "@server/database_service.js";
import { missionRuns, approvalRequests } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function check() {
  const runId = 76;
  try {
    const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId));
    console.log(`\n--- Status for Run ${runId} ---`);
    if (run) {
      console.log(`Status: ${run.status}`);
      console.log(`Resume Condition: ${JSON.stringify(run.resumeCondition, null, 2)}`);
      console.log(`Current Pipeline ID: ${run.currentPipelineId}`);
      console.log(`Current Step Index: ${run.currentStepIndex}`);
      
      const approvals = run.pipelineExecutionId 
        ? await db.select().from(approvalRequests).where(eq(approvalRequests.executionId, String(run.pipelineExecutionId)))
        : [];
      console.log(`\nApprovals for Run ${runId}: ${approvals.length}`);
      approvals.forEach(a => {
        console.log(`- [#${a.id}] status: ${a.status}, output: ${JSON.stringify(a.modifiedOutput)}`);
      });
    } else {
      console.log("Run not found.");
    }
  } catch (err) {
    console.error('Check failed:', err);
  }
  process.exit(0);
}

check();

