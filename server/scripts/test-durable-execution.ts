
import "dotenv/config";
import { db } from "@server/database_service.js";
import { pipelines, pipelineSteps, pipelineExecutions, pipelineStepExecutions } from "@shared/schema/index.js";
import { pipelineEngine as pipelineService } from "@domain/pipeline/core/pipeline.service.js";
import { PipelineExecutor } from "@server/core/pipeline-executor.js";
import { pollAsyncSteps } from "@domain/core/async-poller.service.js";

const pipelineExecutor = new PipelineExecutor();
import { eq, desc } from "drizzle-orm"; // Fixed import

async function main() {
    console.log("Starting Durable Execution Test...");

    // 1. Create a Test Pipeline
    console.log("Creating test pipeline...");
    const [pipeline] = await db.insert(pipelines).values({
        name: `Durable Execution Test Pipeline ${Date.now() + 100}`,
        description: "Testing sleep step",
        triggerType: "manual",
        organizationId: 1,
        createdBy: "test-script"
    }).returning();

    console.log(`Pipeline created: ${pipeline.id}`);

    // 2. Add a Sleep Step
    console.log("Adding sleep step...");
    const [step] = await db.insert(pipelineSteps).values({
        pipelineId: pipeline.id,
        order: 1,
        toolName: "sleep",
        toolArguments: { seconds: 5, reason: "Testing durability" }
    }).returning();

    // 3. Execute Pipeline
    console.log("Executing pipeline...");
    // Signature: executePipeline(pipelineId, userId, startStepId, ttl, initialVariables, parentExecutionId)
    const execution = await pipelineExecutor.executePipeline(pipeline.id, "test-user", null, null, {});
    console.log(`Execution result:`, execution);
    if (!execution.success) {
        console.error("Pipeline execution failed:", execution.error);
        return;
    }
    console.log(`Execution started: ${execution.executionId}`);

    // 4. Verify Suspension
    console.log("Verifying suspension...");
    let stepExec = await db.query.pipelineStepExecutions.findFirst({
        where: eq(pipelineStepExecutions.pipelineExecutionId, execution.executionId),
        orderBy: desc(pipelineStepExecutions.id)
    });

    if (stepExec?.status === "waiting_async" && stepExec.sleepUntil) {
        console.log("SUCCESS: Step is waiting_async and sleepUntil is set.");
        console.log(`Sleep Until: ${stepExec.sleepUntil}`);
    } else {
        console.error("FAILURE: Step is not waiting_async or sleepUntil is missing.");
        console.log("Status:", stepExec?.status);
        console.log("SleepUntil:", stepExec?.sleepUntil);
        return;
    }

    // 5. Test Polling (Early)
    console.log("Testing poller (Current Check - Should Skip)...");
    await pollAsyncSteps();

    // Refresh
    stepExec = await db.query.pipelineStepExecutions.findFirst({
        where: eq(pipelineStepExecutions.pipelineExecutionId, execution.executionId),
        orderBy: desc(pipelineStepExecutions.id)
    });

    if (stepExec?.status === "waiting_async") {
        console.log("SUCCESS: Step is still waiting (User: Please wait 5 seconds...)");
    } else {
        console.error("FAILURE: Step resumed too early!");
    }

    // 6. Wait and Poll (Resume)
    console.log("Waiting 6 seconds...");
    await new Promise(resolve => setTimeout(resolve, 6000));

    console.log("Testing poller (Future Check - Should Resume)...");
    await pollAsyncSteps();

    // Refresh
    stepExec = await db.query.pipelineStepExecutions.findFirst({
        where: eq(pipelineStepExecutions.pipelineExecutionId, execution.executionId),
        orderBy: desc(pipelineStepExecutions.id)
    });

    if (stepExec?.status === "success") {
        console.log("SUCCESS: Step resumed and completed successfully!");
    } else {
        console.error("FAILURE: Step did not complete.");
        console.log("Status:", stepExec?.status);
        console.log("Error:", stepExec?.error);
    }

    // Clean up
    console.log("Cleaning up...");
    await db.delete(pipelines).where(eq(pipelines.id, pipeline.id));
}

main().catch(console.error);

