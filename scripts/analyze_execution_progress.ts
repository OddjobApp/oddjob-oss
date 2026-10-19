import { db } from "../server/db/index.js";
import { pipelineExecutions, pipelineStepExecutions } from "../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function main() {
    const executionId = parseInt(process.argv[2] || "664");
    console.log(`=== Detailed Analysis for Execution ${executionId} ===`);
    
    const [execution] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, executionId)).limit(1);
    if (!execution) {
        console.error("Execution not found");
        process.exit(1);
    }

    console.log(`Execution Status: ${execution.status}`);
    console.log(`Execution Error: ${execution.error}`);
    console.log(`Last Heartbeat: ${execution.lastHeartbeat}`);

    const steps = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, executionId)).orderBy(pipelineStepExecutions.stepOrder);
    console.log(`\nSteps find (${steps.length}):`);
    for (const s of steps) {
        console.log(`- Order ${s.stepOrder} (ID ${s.id}): ${s.status}`);
        if (s.error) {
            console.log(`  ERROR: ${s.error}`);
        }
    }

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
