import "dotenv/config";
import { db } from "../db/index.js";
import { pipelineExecutions, pipelineStepExecutions, pipelineSteps } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
  console.log("--- Checking Execution 36 Steps ---");
  
  const execId = 36;
  const steps = await db.select({
    stepId: pipelineStepExecutions.pipelineStepId,
    status: pipelineStepExecutions.status,
    output: pipelineStepExecutions.output,
    executedAt: pipelineStepExecutions.executedAt
  })
  .from(pipelineStepExecutions)
  .where(eq(pipelineStepExecutions.pipelineExecutionId, execId));

  console.log(JSON.stringify(steps, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

