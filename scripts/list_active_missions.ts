import { db } from "../server/db/index.js";
import { missionRuns } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    console.log("=== Active Mission Runs ===");
    const activeMissions = await db.select().from(missionRuns).where(eq(missionRuns.status, 'active'));
    console.table(activeMissions.map(m => ({
        id: m.id,
        missionId: m.missionId,
        status: m.status,
        executionId: m.pipelineExecutionId,
        updatedAt: m.updatedAt
    })));
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
