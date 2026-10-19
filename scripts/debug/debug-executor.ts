
import "dotenv/config";
import { db } from "@server/database_service.js";
import { pipelines, pipelineSteps, pipelineExecutions } from "@shared/schema/index.js";
import { eq, and, isNull } from "drizzle-orm";

const PIPE_ID = 121;
const EXEC_ID = 408;

async function debugExecutor() {
    console.log(`Debugging Pipeline ${PIPE_ID} Execution...`);

    // 1. Get Steps
    const steps = await db.select().from(pipelineSteps).where(eq(pipelineSteps.pipelineId, PIPE_ID));
    console.log(`Found ${steps.length} steps.`);

    // 2. Identify Start Steps (Graph analysis)
    // A start step is one that is NOT a destination of any other step.
    const destStepIds = new Set(steps.map((s: any) => s.destinationStepId).filter(id => id != null));
    console.log(`Destination IDs:`, Array.from(destStepIds));

    // Also check if any step has `conditionExpression` or other dependencies?
    // Usually standard pipelines are linear based on `order`?
    // Wait, the Schema has `order`. Older Logic might use `order`.
    // Let's check `PipelineExecutor` logic via `read_resource` or `view_file`? No, I'll infer from context.

    // If using Order:
    const sortedSteps = steps.sort((a, b) => a.order - b.order);
    const startStep = sortedSteps[0];
    console.log(`Start Step by Order: Step ${startStep.id} (Order ${startStep.order})`);

    // 3. Why didn't it schedule?
    console.log("Simulating scheduling...");

    // Try creating a step execution MANUALLY to see if DB allows it.
    /*
    await db.insert(pipelineStepExecutions).values({
        pipelineExecutionId: EXEC_ID,
        pipelineStepId: startStep.id,
        jobId: startStep.jobId,
        stepOrder: startStep.order,
        status: "queued"
    });
    */
    // If this works, then the Executor logic failed.

    process.exit(0);
}

debugExecutor().catch(console.error);
