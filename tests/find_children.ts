
import { db } from "../server/db";
import { pipelineExecutions } from "../shared/schema/index.js";
import { isNotNull } from "drizzle-orm";

async function run() {
    console.log("FETCHING_CHILDREN");
    const children = await db.select().from(pipelineExecutions).where(isNotNull(pipelineExecutions.parentExecutionId)).execute();
    console.log(`FOUND_CHILDREN: ${children.length}`);
    for (const child of children) {
        console.log(`ID: ${child.id}, PARENT: ${child.parentExecutionId}, STATUS: ${child.status}`);
    }
    process.exit(0);
}

run();
