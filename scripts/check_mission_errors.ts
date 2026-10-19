import { db } from "../server/db/index.js";
import { missionRuns, pipelineExecutions } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    const runId = 245;
    const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);
    
    console.log(`=== Mission Run ${runId} ===`);
    console.log(`Status: ${run?.status}`);
    console.log(`Mission Context: ${JSON.stringify(run?.missionContext, null, 2)}`);

    if (run?.pipelineExecutionId) {
        const [execution] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, run.pipelineExecutionId)).limit(1);
        console.log(`\n=== Pipeline Execution ${run.pipelineExecutionId} ===`);
        console.log(`Status: ${execution?.status}`);
        console.log(`Error: ${execution?.error}`);
    }

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
