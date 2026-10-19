
import { db } from "../server/database_service.js";
import { missionRuns } from "../shared/schema/index.js";
import { desc, eq, and, ne } from "drizzle-orm";

async function main() {
    console.log("📊 Sequential Mission Monitor");
    console.log("----------------------------");

    const recentRuns = await db.select()
        .from(missionRuns)
        .where(ne(missionRuns.status, 'draft'))
        .orderBy(desc(missionRuns.createdAt))
        .limit(5);

    for (const run of recentRuns) {
        console.log(`Run ID: ${run.id} | Status: ${run.status} | Created: ${run.createdAt}`);
        console.log(`Context: ${JSON.stringify(run.missionContext, null, 2)}`);
        console.log(`Trace: ${JSON.stringify(run.dynamicTrace, null, 2)}`);
        console.log("----------------------------");
    }

    process.exit(0);
}

main().catch(console.error);
