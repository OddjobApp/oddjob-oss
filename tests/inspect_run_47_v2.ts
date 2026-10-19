
import { db } from "../server/db";
import { missionRuns, pipelineExecutions, pipelineStepExecutions } from "../shared/schema/index.js";
import { eq, or } from "drizzle-orm";

async function inspect() {
    console.log("INSPECTION_START");
    const runId = 47;
    const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);

    if (!run) {
        console.error("Run 47 not found");
        process.exit(1);
    }

    console.log(`RUN_ID: ${run.id}`);
    console.log(`RUN_STATUS: ${run.status}`);
    console.log(`EXECUTION_ID: ${run.pipelineExecutionId}`);

    const execId = run.pipelineExecutionId;
    if (!execId) {
        console.error("No execution ID");
        process.exit(1);
    }

    const execs = await db.select().from(pipelineExecutions).where(
        or(
            eq(pipelineExecutions.id, execId),
            eq(pipelineExecutions.parentExecutionId, execId)
        )
    ).execute();

    console.log(`FOUND_EXECUTIONS: ${execs.length}`);
    for (const exec of execs) {
        console.log(`EXEC_ID: ${exec.id}, STATUS: ${exec.status}, PARENT: ${exec.parentExecutionId}`);
        const steps = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, exec.id)).execute();
        for (const step of steps) {
            console.log(`  STEP_ORDER: ${step.stepOrder}, STATUS: ${step.status}`);
            if (step.status === "waiting_external_input") {
                console.log(`  HIL_SUSPENSION_DETECTED: ${step.id}`);
            }
        }
    }
    console.log("INSPECTION_END");
    process.exit(0);
}

inspect();
