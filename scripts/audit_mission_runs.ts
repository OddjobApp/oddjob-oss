import { db } from "../server/db/index.js";
import { missionRuns } from "../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function main() {
    const missionId = 112;
    console.log(`=== Runs for Mission ${missionId} ===`);
    const runs = await db.select().from(missionRuns).where(eq(missionRuns.missionId, missionId)).orderBy(desc(missionRuns.id));
    console.table(runs.map(r => ({
        id: r.id,
        status: r.status,
        executionId: r.pipelineExecutionId,
        updatedAt: r.updatedAt
    })));
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
