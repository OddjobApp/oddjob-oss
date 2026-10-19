
import { db } from "../server/db";
import { missionRuns } from "../shared/schema/index.js";
import { desc } from "drizzle-orm";

async function run() {
    console.log("FETCHING_RUNS");
    const runs = await db.select().from(missionRuns).orderBy(desc(missionRuns.id)).limit(10).execute();
    console.log(`FOUND_RUNS: ${runs.length}`);
    for (const run of runs) {
        console.log(`ID: ${run.id}, STATUS: ${run.status}, MISSION: ${run.missionId}, EXEC: ${run.pipelineExecutionId}`);
    }
    process.exit(0);
}

run();
