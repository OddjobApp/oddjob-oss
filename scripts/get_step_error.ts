import { db } from "../server/db/index.js";
import { pipelineStepExecutions } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    const stepId = 2544;
    const [step] = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.id, stepId)).limit(1);
    console.log(`Step ID: ${stepId}`);
    console.log(`Error: ${step?.error}`);
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
