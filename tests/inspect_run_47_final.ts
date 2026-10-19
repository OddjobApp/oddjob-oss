
import { db } from "../server/db";
import { missionRuns, pipelineExecutions, pipelineStepExecutions } from "../shared/schema/index.js";
import { eq, or } from "drizzle-orm";

async function inspect() {
    const runId = 47;
    const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);

    if (!run) {
        console.error("Run 47 not found");
        process.exit(1);
    }

    console.log(`RUN_ID: ${run.id}`);
    console.log(`RUN_STATUS: ${run.status}`);
    console.log(`EXECUTION_ID: ${run.pipelineExecutionId}`);

    const execs = await db.select().from(pipelineExecutions).where(
        or(
            eq(pipelineExecutions.id, run.pipelineExecutionId!),
            eq(pipelineExecutions.parentExecutionId, run.pipelineExecutionId!)
        )
    ).execute();

    for (const exec of execs) {
        console.log(`EXEC_ID: ${exec.id}, STATUS: ${exec.status}, PARENT: ${exec.parentExecutionId}`);
        const steps = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, exec.id)).execute();
        for (const step of steps) {
            console.log(`  STEP_ORDER: ${step.stepOrder}, STATUS: ${step.status}, OUTPUT: ${step.output.substring(0, 100)}`);
        }
    }
    process.exit(0);
}

inspect();
