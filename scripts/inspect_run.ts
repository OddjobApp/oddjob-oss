
import { db } from "../server/db/index.js";
import { missionRuns, pipelineExecutions } from "../shared/schema/index";
import { eq, desc } from "drizzle-orm";

async function inspect(runId: number) {
  const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId));
  if (!run) {
    console.error("Run not found");
    return;
  }
  console.log(`=== Mission Run ${runId} ===`);
  console.log(`Status: ${run.status}`);
  console.log(`Execution ID: ${run.pipelineExecutionId}`);

  if (run.pipelineExecutionId) {
    const [exec] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, run.pipelineExecutionId));
    if (exec) {
      console.log(`Execution Status: ${exec.status}`);
      console.log(`Execution Error: ${exec.error}`);
    }
  }
  process.exit(0);
}

inspect(parseInt(process.argv[2])).catch(err => {
  console.error(err);
  process.exit(1);
});
