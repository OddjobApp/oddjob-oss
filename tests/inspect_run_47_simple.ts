
import { db } from "../server/db";
import { pipelineExecutions, pipelineStepExecutions } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function inspect() {
    console.log("START_INSPECTION");
    const parentExecutionId = 35; // From previous run output
    const children = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.parentExecutionId, parentExecutionId)).execute();
    console.log(`FOUND_CHILDREN: ${children.length}`);
    for (const child of children) {
        console.log(`CHILD_ID: ${child.id}, STATUS: ${child.status}`);
        const steps = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, child.id)).execute();
        for (const step of steps) {
            console.log(`  STEP_ORDER: ${step.stepOrder}, STATUS: ${step.status}, OUTPUT: ${step.output.substring(0, 50)}`);
        }
    }
    console.log("END_INSPECTION");
    process.exit(0);
}

inspect();
