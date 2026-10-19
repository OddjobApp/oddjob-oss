
import { db } from "../server/database_service.js";
import { missionRuns } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    const runId = parseInt(process.argv.find(arg => arg.startsWith('--run-id'))?.split('=')[1] || "0");
    if (!runId) {
        console.error("Please provide --run-id=XXX");
        process.exit(1);
    }

    const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);
    if (!run) {
        console.error("Run not found");
        process.exit(1);
    }

    console.log(`--- Trace for Run ${runId} ---`);
    console.log(JSON.stringify(run.dynamicTrace, null, 2));
    
    console.log("\n--- Context ---");
    console.log(JSON.stringify(run.missionContext, null, 2));

    process.exit(0);
}

main().catch(console.error);
