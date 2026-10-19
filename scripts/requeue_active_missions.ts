
import { db } from "../server/database_service.js";
import { missionRuns } from "../shared/schema/index.js";
import { eq, and, notInArray } from "drizzle-orm";
import { queueMissionCycle } from "../server/domain/mission/infrastructure/dynamic-mission-queue.js";

async function requeue() {
    console.log("Fetching active mission runs...");
    const activeRuns = await db.select().from(missionRuns).where(eq(missionRuns.status, 'active'));
    console.log(`Found ${activeRuns.length} active runs.`);
    
    for (const run of activeRuns) {
        console.log(`Re-queueing run ${run.id} for user ${run.createdBy}`);
        await queueMissionCycle({
            missionRunId: run.id,
            userId: run.createdBy || "agent",
            orgId: run.organizationId
        });
    }
    
    process.exit(0);
}

requeue().catch(console.error);
