import "dotenv/config";
import { db } from "../db/index.js";
import { pipelineStepExecutions, approvalRequests } from "../../shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function main() {
  const execId = 41;
  const steps = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, execId));
  console.log("Steps Count:", steps.length);

  for (const s of steps) {
    console.log(`Step ID: ${s.id}, Job ID: ${s.jobId}, Status: ${s.status}`);
    const approvals = await db.select().from(approvalRequests).where(eq(approvalRequests.executionId, String(s.id)));
    console.log(`Approvals for Step ${s.id}:`, JSON.stringify(approvals, null, 2));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

