
import { db } from "../server/database_service.js";
import { missionRuns } from "../shared/schema/index.js";
import { desc } from "drizzle-orm";

async function main() {
    const runs = await db.select().from(missionRuns).orderBy(desc(missionRuns.createdAt)).limit(10);
    console.log('MISSION RUNS:', JSON.stringify(runs, null, 2));
    process.exit(0);
}

main().catch(console.error);
