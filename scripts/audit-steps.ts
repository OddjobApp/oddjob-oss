import { db } from "../server/db/index.js";
import { pipelineStepExecutions, pipelineExecutions } from "../shared/schema/index.js";
import { eq, inArray, desc } from "drizzle-orm";

async function auditSteps() {
  const missionRunIds = [268, 269, 270];
  console.log("--- Pipeline Step Audit ---");

  const execs = await db.select().from(pipelineExecutions).where(inArray(pipelineExecutions.missionRunId, missionRunIds));
  
  for (const ex of execs) {
    console.log(`\nPipeline Exec ${ex.id} (Run ${ex.missionRunId}) - Status: ${ex.status}`);
    const steps = await db.select().from(pipelineStepExecutions)
      .where(eq(pipelineStepExecutions.pipelineExecutionId, ex.id))
      .orderBy(pipelineStepExecutions.stepOrder);
    
    for (const s of steps) {
      console.log(`  Step ${s.stepOrder}: ${s.outputName || 'unnamed'} - Status: ${s.status} ${s.error ? '- Error: ' + s.error.substring(0, 100) : ''}`);
    }
  }
  process.exit(0);
}

auditSteps().catch(err => {
  console.error(err);
  process.exit(1);
});
