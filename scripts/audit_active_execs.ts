import { db } from "../server/db/index.js";
import { pipelineExecutions, pipelineStepExecutions, missionRuns } from "../shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function main() {
    console.log("=== Active Executions Audit ===");
    
    const activeExecs = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.status, 'running'));
    console.log(`Found ${activeExecs.length} running executions.`);

    for (const exec of activeExecs) {
        const [run] = await db.select().from(missionRuns).where(eq(missionRuns.pipelineExecutionId, exec.id)).limit(1);
        console.log(`\nExecution ID ${exec.id} (Run ${run?.id || 'N/A'}):`);
        
        const steps = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, exec.id)).orderBy(pipelineStepExecutions.stepOrder);
        console.table(steps.map(s => ({
            id: s.id,
            order: s.stepOrder,
            jobId: s.jobId,
            status: s.status,
            error: s.error ? "YES" : "NO"
        })));
    }

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
