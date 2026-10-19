import { db } from "../server/db/index.js";
import { agentDeployments, missionRuns, pipelineExecutions } from "../shared/schema/index.js";
import { eq, or, desc } from "drizzle-orm";

async function diagnose() {
  console.log("--- Agent 81 Diagnostics ---");
  const [agent] = await db.select().from(agentDeployments)
    .where(or(eq(agentDeployments.id, 81), eq(agentDeployments.slug, "agent-81")))
    .limit(1);

  if (!agent) {
    console.log("Agent 81 not found.");
    process.exit(0);
  }

  console.log(`Agent ID: ${agent.id}`);
  console.log(`Slug: ${agent.slug}`);
  console.log(`Job ID: ${agent.jobId}`);
  console.log(`Status: ${agent.isActive ? 'Active' : 'Inactive'}`);

  const activeRuns = await db.select().from(missionRuns)
    .where(eq(missionRuns.missionId, agent.jobId))
    .orderBy(desc(missionRuns.createdAt))
    .limit(5);

  console.log("\n--- Recent Mission Runs ---");
  for (const run of activeRuns) {
    console.log(`Run ${run.id}: Status=${run.status}, PipelineExecID=${run.pipelineExecutionId}`);
    
    if (run.pipelineExecutionId) {
      const [exec] = await db.select().from(pipelineExecutions)
        .where(eq(pipelineExecutions.id, run.pipelineExecutionId))
        .limit(1);
      if (exec) {
        console.log(`  -> Pipeline Exec Status: ${exec.status}, LastHeartbeat: ${exec.lastHeartbeat}`);
      }
    }
  }

  process.exit(0);
}

diagnose().catch(err => {
  console.error(err);
  process.exit(1);
});
