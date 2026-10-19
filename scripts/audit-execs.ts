import { db } from "../server/db/index.js";
import { pipelineExecutions, pipelines } from "../shared/schema/index.js";
import { desc, eq } from "drizzle-orm";

async function audit() {
  console.log("--- Recent Pipeline Executions Audit ---");
  const execs = await db.select({
    id: pipelineExecutions.id,
    pipelineId: pipelineExecutions.pipelineId,
    status: pipelineExecutions.status,
    startedAt: pipelineExecutions.startedAt,
    error: pipelineExecutions.error,
    missionId: pipelineExecutions.missionId,
    missionRunId: pipelineExecutions.missionRunId,
    pipelineName: pipelines.name
  })
  .from(pipelineExecutions)
  .leftJoin(pipelines, eq(pipelineExecutions.pipelineId, pipelines.id))
  .orderBy(desc(pipelineExecutions.startedAt))
  .limit(20);

  for (const ex of execs) {
    console.log(`\n--- Exec ${ex.id} ---`);
    console.log(`Pipeline: ${ex.pipelineName || ex.pipelineId}`);
    console.log(`Status: ${ex.status}`);
    console.log(`Run: ${ex.missionRunId}`);
    if (ex.error) {
      console.log(`Error: ${ex.error}`);
    }
  }
  process.exit(0);
}

audit().catch(err => {
  console.error(err);
  process.exit(1);
});
