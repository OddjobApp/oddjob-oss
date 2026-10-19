
import { db } from "../database_service.js";
import { missionRuns, pipelineExecutions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function run() {
    console.log("--- START ANALYSIS ---");
    const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, 151)).limit(1);
    if (!run) {
        console.log("Run not found");
        return;
    }
    const [exec] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, run.pipelineExecutionId!)).limit(1);
    
    console.log("RUN_STATUS:", run.status);
    console.log("FAILURE_REASON:", run.failureReason);
    console.log("EXEC_ERROR:", exec?.error);
    console.log("CONTEXT:", JSON.stringify(run.missionContext, null, 2));
    console.log("--- END ANALYSIS ---");
}

run().catch(console.error).finally(() => process.exit(0));

