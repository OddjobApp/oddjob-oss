
import { db } from "../server/database_service.js";
import { missionRuns } from "../shared/schema/index.js";
import { eq, inArray, desc } from "drizzle-orm";

async function main() {
    const runs = await db.select()
        .from(missionRuns)
        .where(inArray(missionRuns.id, [2091, 2092, 2093]))
        .orderBy(desc(missionRuns.id));

    for (const run of runs) {
        console.log(`Run ID: ${run.id} | Status: ${run.status} | Phase: ${(run.missionContext as any)?.phase}`);
    }
    process.exit(0);
}

main().catch(console.error);
