
import { db } from "../server/db";
import { missionRuns, pipelineExecutions } from "../shared/schema/index.js";
import { desc, eq } from "drizzle-orm";

async function run() {
    console.log("FETCHING_RUNS_AND_EXECS");
    const runs = await db.select().from(missionRuns).orderBy(desc(missionRuns.id)).limit(10).execute();
    console.log(`FOUND_RUNS: ${runs.length}`);
    for (const run of runs) {
        let execStatus = "N/A";
        if (run.pipelineExecutionId) {
            const [exec] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, run.pipelineExecutionId)).limit(1).execute();
            if (exec) {
                execStatus = exec.status;
            }
        }
        console.log(`ID: ${run.id}, STATUS: ${run.status}, MISSION: ${run.missionId}, EXEC_ID: ${run.pipelineExecutionId}, EXEC_STATUS: ${execStatus}`);
    }
    process.exit(0);
}

run();
