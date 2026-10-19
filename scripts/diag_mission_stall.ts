import { db } from "../server/db/index.js";
import { missionRuns, pipelineExecutions, pipelineStepExecutions } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    console.log("=== Stalled Mission Diagnostic (Verification) ===");
    
    const runId = 245;
    const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);
    
    if (!run) {
        console.error(`Mission Run ${runId} not found!`);
        process.exit(1);
    }

    console.log(`Mission Run ${run.id}: ${run.name}`);
    console.log(`Status: ${run.status}`);
    console.log(`Pipeline Execution ID: ${run.pipelineExecutionId}`);

    if (run.pipelineExecutionId) {
        const [execution] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, run.pipelineExecutionId)).limit(1);
        if (execution) {
            console.log(`✅ Pipeline Execution ${execution.id} found.`);
            console.log(`Execution Status: ${execution.status}`);
            
            const steps = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, execution.id));
            console.log(`Step Count: ${steps.length}`);
            if (steps.length > 0) {
                console.log("✅ Mission is active and processing steps!");
            } else {
                console.log("❌ Mission still has 0 steps.");
            }
        } else {
            console.log(`❌ Pipeline Execution ${run.pipelineExecutionId} still missing!`);
        }
    } else {
        console.log("❌ Mission has no associated Pipeline Execution ID.");
    }

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
