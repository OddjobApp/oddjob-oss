import { db } from "@server/database_service.js";
import { jobs, pipelines, pipelineSteps, pipelineExecutions, pipelineStepExecutions } from "../../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function run() {
    console.log("--- Debugging Dealer Search ---");

    // 1. Inspect Job 22
    const [searchDealerJob] = await db.select().from(jobs).where(eq(jobs.id, 22));
    console.log("\nJob 22 (Search Dealer):", JSON.stringify(searchDealerJob, null, 2));

    // 2. Inspect Pipeline 14
    const [dealerSearchPipeline] = await db.select().from(pipelines).where(eq(pipelines.id, 14));
    console.log("\nPipeline 14 (Dealer Search):", JSON.stringify(dealerSearchPipeline, null, 2));

    // 3. Inspect Pipeline Steps
    const steps = await db.select().from(pipelineSteps).where(eq(pipelineSteps.pipelineId, 14));
    console.log("\nPipeline Steps for 14:", JSON.stringify(steps, null, 2));

    // 4. Inspect Recent Executions
    const lastExecutions = await db.select()
        .from(pipelineExecutions)
        .where(eq(pipelineExecutions.pipelineId, 14))
        .orderBy(desc(pipelineExecutions.startedAt))
        .limit(3);
    console.log("\nLast 3 Executions for Pipeline 14:", JSON.stringify(lastExecutions, null, 2));

    if (lastExecutions.length > 0) {
        const stepExecs = await db.select()
            .from(pipelineStepExecutions)
            .where(eq(pipelineStepExecutions.pipelineExecutionId, lastExecutions[0].id));
        console.log("\nStep Executions for last run:", JSON.stringify(stepExecs, null, 2));
    }
}

run().catch(console.error);
