import { db } from "../server/db/index.js";
import { missionRuns, pipelines, pipelineExecutions } from "../shared/schema/index.js";
import { inArray, desc } from "drizzle-orm";

async function monitor() {
  const runIds = [268, 269, 270];
  const runs = await db.select().from(missionRuns).where(inArray(missionRuns.id, runIds));
  
  console.log("--- Mission Run Status ---");
  for (const run of runs) {
    console.log(`Run ${run.id} [${run.name}]: Status=${run.status}, Success=${run.isSuccess}, FailReason=${run.failureReason || 'N/A'}`);
    
  }
  
  // Check ALL recent pipeline executions
  const recentExecs = await db.select().from(pipelineExecutions).orderBy(desc(pipelineExecutions.startedAt)).limit(10);
  console.log("\n--- Recent Pipeline Executions ---");
  for (const exec of recentExecs) {
    console.log(`Exec ${exec.id}: Pipeline=${exec.pipelineId}, Status=${exec.status}, StartedAt=${exec.startedAt}`);
  }
}

monitor().catch(err => {
  console.error(err);
  process.exit(1);
});

// Helper for 'eq' since I didn't import it in a way that works inside this script easily if I'm not careful
import { eq } from "drizzle-orm";

monitor().catch(err => {
  console.error(err);
  process.exit(1);
});
