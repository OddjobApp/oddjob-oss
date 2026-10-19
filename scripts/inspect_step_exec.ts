
import { db } from "../server/db/index.js";
import { pipelineStepExecutions, pipelineSteps, jobs, credentials } from "../shared/schema/index";
import { eq } from "drizzle-orm";

async function inspectStep(stepExecId: number) {
  console.log(`=== Inspecting Step Execution ${stepExecId} ===`);

  const [stepExec] = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.id, stepExecId));
  if (!stepExec) {
    console.error("Step execution not found");
    return;
  }

  const [step] = await db.select().from(pipelineSteps).where(eq(pipelineSteps.id, stepExec.pipelineStepId));
  if (!step) {
    console.error("Step definition not found");
    return;
  }

  console.log(`Step: ${step.id} (Order ${step.order}, Job ${step.jobId})`);

  const [job] = await db.select().from(jobs).where(eq(jobs.id, step.jobId!));
  if (!job) {
    console.error("Job not found");
    return;
  }

  console.log(`Job: ${job.name} (${job.type})`);
  console.log(`Config: ${JSON.stringify(job.config, null, 2)}`);

  const config = job.config as any;
  if (config && config.credentialId) {
    const [credential] = await db.select().from(credentials).where(eq(credentials.id, config.credentialId));
    if (credential) {
      console.log(`Credential: ${credential.name} (Env var: ${credential.envVarName})`);
      console.log(`Metadata: ${JSON.stringify(credential.metadata, null, 2)}`);
      
      const envValue = process.env[credential.envVarName];
      console.log(`Environment Variable Value: ${envValue ? "FOUND (REDACTED)" : "NOT FOUND"}`);
    } else {
      console.warn("Credential not found for ID:", config.credentialId);
    }
  } else {
    console.warn("No credentialId found in job config");
  }

  process.exit(0);
}

const stepExecId = parseInt(process.argv[2]);
if (isNaN(stepExecId)) {
  console.error("Please provide a step execution ID");
  process.exit(1);
}

inspectStep(stepExecId).catch(err => {
  console.error(err);
  process.exit(1);
});
