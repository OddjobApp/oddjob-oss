
import { db } from "../server/db/index.js";
import { pipelineExecutions, pipelineStepExecutions, pipelineSteps, pipelines } from "../shared/schema/index";
import { eq, and } from "drizzle-orm";
import { PipelineExecutor } from "../server/core/pipeline-executor";
import { executePipelineStep } from "../server/core/pipeline-step-runner";
import jobService from "../server/domain/jobs/job.service";

async function diag() {
  const executionId = 660;
  console.log(`=== Diagnosing Execution ${executionId} ===`);

  const [execution] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, executionId));
  if (!execution) {
    console.error("Execution not found");
    return;
  }

  const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, execution.pipelineId));
  const steps = await db.select().from(pipelineSteps).where(eq(pipelineSteps.pipelineId, pipeline.id));
  
  // Find the pending step
  const [pendingStepExec] = await db.select().from(pipelineStepExecutions).where(
    and(
      eq(pipelineStepExecutions.pipelineExecutionId, executionId),
      eq(pipelineStepExecutions.status, "pending")
    )
  );

  if (!pendingStepExec) {
    console.log("No pending step found. Execution might have finished or failed.");
    return;
  }

  const step = steps.find(s => s.id === pendingStepExec.pipelineStepId);
  if (!step) {
    console.error("Step definition not found");
    return;
  }

  console.log(`Found pending step: ${step.id} (Order ${step.order}, Job ${step.jobId})`);

  // Attempt to execute this specific step directly with full logging
  console.log("Attempting direct execution of step...");
  
  try {
    const job = await jobService.getJob(step.jobId!, { userId: "system", organizationId: 1, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false });
    console.log(`Job details: ${job?.name} (${job?.type})`);

    const result = await executePipelineStep(
      step,
      pipeline,
      { positional: {}, named: {}, history: {}, data: {} } as any,
      false,
      executionId,
      pendingStepExec.id
    );

    console.log("Step Execution Result:", JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error("CRITICAL ERROR DURING STEP EXECUTION:", err.message);
    if (err.stack) console.error(err.stack);
  }

  process.exit(0);
}

diag().catch(err => {
  console.error(err);
  process.exit(1);
});
