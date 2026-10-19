
import { db } from "../server/database_service.js";
import { missionRuns } from "../shared/schema/index.js";
import { inArray, eq } from "drizzle-orm";

async function main() {
    const ids = [2091, 2092, 2093];
    const runs = await db.select().from(missionRuns).where(inArray(missionRuns.id, ids));
    for (const run of runs) {
        console.log(`Run ID: ${run.id} | Status: ${run.status} | Phase: ${(run.missionContext as any)?.phase} | Failure: ${run.failureReason}`);
    }
    process.exit(0);
}

main().catch(console.error);
