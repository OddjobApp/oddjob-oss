
import { db } from "@server/database_service.js";
import { pipelineStepExecutions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    const executionId = 15;
    const steps = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, executionId));
    console.log(JSON.stringify(steps, null, 2));
    process.exit(0);
}

main().catch(console.error);
