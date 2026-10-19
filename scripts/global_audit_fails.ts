import { db } from "../server/db/index.js";
import { missionRuns, pipelineStepExecutions, missions } from "../shared/schema/index.js";
import { eq, desc, and } from "drizzle-orm";

async function main() {
    console.log("=== Global Audit of Recent Failures ===");
    
    const recentFails = await db.select()
        .from(missionRuns)
        .where(eq(missionRuns.status, 'failed'))
        .orderBy(desc(missionRuns.id))
        .limit(10);
    
    console.log(`\nRecent Failed Mission Runs (${recentFails.length}):`);
    for (const run of recentFails) {
        const [m] = await db.select().from(missions).where(eq(missions.id, run.missionId!)).limit(1);
        console.log(`- Run ${run.id}: ${m?.name} (Status: ${run.status}, Execution: ${run.pipelineExecutionId})`);
    }

    const recentStepFails = await db.select()
        .from(pipelineStepExecutions)
        .where(eq(pipelineStepExecutions.status, 'failed'))
        .orderBy(desc(pipelineStepExecutions.id))
        .limit(10);

    console.log(`\nRecent Failed Pipeline Steps (${recentStepFails.length}):`);
    for (const step of recentStepFails) {
        console.log(`- Step ${step.id} (Exec ${step.pipelineExecutionId}): ${step.error?.substring(0, 100)}`);
    }

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
