// @ts-nocheck
import { db } from "../server/db/index.js";
import { jobs, agentDeployments } from "../shared/schema/index.js";
import { eq, or } from "drizzle-orm";

async function diagnoseJob() {
  console.log("--- Job 81 / Agent 81 Deep Dive ---");

  // 1. Check Job 81
  const [job] = await db.select().from(jobs).where(eq(jobs.id, 81)).limit(1);
  if (job) {
    console.log("Job 81 Found:");
    console.log(`  Name: ${job.name}`);
    console.log(`  Type: ${job.type}`);
    console.log(`  Status: ${job.lifecycleStatus}`);
    console.log(`  Config: ${JSON.stringify(job.config)}`);
  } else {
    console.log("Job 81 not found in jobs table.");
  }

  // 2. Check for any active tasks/steps for this job
  const { pipelineStepExecutions } = await import("../shared/schema/index.js");
  const activeSteps = await db.select().from(pipelineStepExecutions)
    .where(eq(pipelineStepExecutions.jobId, 81))
    .limit(10);
  
  if (activeSteps.length > 0) {
    console.log(`\nFound ${activeSteps.length} pipeline step executions for Job 81.`);
    for (const step of activeSteps) {
       console.log(`  Step ID: ${step.id}, Status: ${step.status}, StartedAt: ${step.startedAt}`);
    }
  } else {
    console.log("\nNo active pipeline steps found for Job 81.");
  }

  process.exit(0);
}

diagnoseJob().catch(err => {
  console.error(err);
  process.exit(1);
});
