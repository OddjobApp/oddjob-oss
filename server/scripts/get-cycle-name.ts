import "dotenv/config";
import { db } from "@server/database_service.js";
import { operationalCycles } from "@shared/schema/index.js";
import { desc } from "drizzle-orm";

async function run() {
    const cycles = await db.select().from(operationalCycles).orderBy(desc(operationalCycles.id)).limit(1);
    console.log("LATEST_CYCLE_NAME: " + cycles[0].name);
    process.exit(0);
}
run();
