
import { db } from "../server/db";
import { pipelineStepExecutions, pipelineExecutions, missionRuns } from "../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function run() {
    console.log("FINAL_VALIDATION");
    // Find any step in "waiting_external_input"
    const steps = await db.select().from(pipelineStepExecutions)
        .orderBy(desc(pipelineStepExecutions.executedAt))
        .limit(100).execute();
    
    console.log(`ANALYZING_RECENT_STEPS: ${steps.length}`);
    for (const step of steps) {
        if (step.status === "waiting_external_input") {
             console.log(`MATCH_FOUND: STEP_ID: ${step.id}, STATUS: ${step.status}, EXEC_ID: ${step.pipelineExecutionId}`);
        }
    }
    process.exit(0);
}

run();
