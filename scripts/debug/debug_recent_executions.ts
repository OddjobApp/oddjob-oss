
import { db } from "@server/database_service.js";
import { pipelineExecutions } from "@shared/schema/index.js";
import { desc } from "drizzle-orm";

async function main() {
    const lastExecutions = await db.select().from(pipelineExecutions).orderBy(desc(pipelineExecutions.id)).limit(5);
    console.log(JSON.stringify(lastExecutions, null, 2));
    process.exit(0);
}

main().catch(console.error);
