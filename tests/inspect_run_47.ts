
import { db } from "../server/db";
import { missions, missionRuns, pipelineExecutions, pipelineStepExecutions } from "../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function inspect() {
    const runId = 47;
    const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);

    if (!run) {
        console.error("Run 47 not found");
        process.exit(1);
    }

    console.log(`--- MISSION RUN 47 ---`);
    console.log(`Status: ${run.status}`);
    console.log(`Mission ID: ${run.missionId}`);
    console.log(`Execution ID: ${run.pipelineExecutionId}`);
    console.log(`Context: ${JSON.stringify(run.missionContext, null, 2)}`);

    // 1. Inspect Pipeline Execution
    const [execution] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, run.pipelineExecutionId)).limit(1);
    console.log(`\n--- PIPELINE EXECUTION ---`);
    console.log(`Status: ${execution.status}`);

    // 2. Inspect Pipeline Step Executions (Supervisor Step)
    const steps = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, run.pipelineExecutionId)).execute();
    console.log(`\n--- PIPELINE STEP EXECUTIONS (SUPERVISOR) ---`);
    for (const step of steps) {
        console.log(`Step ID: ${step.id}, Order: ${step.stepOrder}, Status: ${step.status}`);
        // console.log(`Output: ${step.output}`);
    }

    // 3. Inspect Child Pipeline Executions
    console.log("\n--- CHILD PIPELINE EXECUTIONS ---");
    const children = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.parentExecutionId, run.pipelineExecutionId)).execute();
    for (const child of children) {
        console.log(`Child ID: ${child.id}, Status: ${child.status}, Created: ${child.createdAt}`);
        
        const childSteps = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, child.id)).execute();
        for (const step of childSteps) {
            console.log(`  Step order ${step.stepOrder}, Status: ${step.status}, Output: ${step.output.substring(0, 100)}...`);
        }
    }

    process.exit(0);
}

inspect();
