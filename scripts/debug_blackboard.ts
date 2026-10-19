
import { db } from "../server/database_service.js";
import { missionRuns, missions } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    const runId = parseInt(process.argv.find(arg => arg.startsWith('--run-id'))?.split('=')[1] || "0");
    if (!runId) {
        process.exit(1);
    }

    const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);
    if (run) {
        const [m] = await db.select().from(missions).where(eq(missions.id, run.missionId!)).limit(1);
        console.log("--- Blackboard for Mission " + run.missionId + " ---");
        console.log(JSON.stringify(m?.blackboard, null, 2));
    }
    process.exit(0);
}

main().catch(console.error);
