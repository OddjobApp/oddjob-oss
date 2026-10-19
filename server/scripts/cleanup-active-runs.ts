import "dotenv/config";
import { db } from "../database_service.js";
import { missionRuns } from "../../shared/schema/index.js";
import { and, eq, ne, inArray, notInArray } from "drizzle-orm";

async function cleanup() {
    console.log("Cleaning up stale active mission runs to unblock the queue...");
    
    // We want to keep run 3419 and 3420 (the new cycle runs) active, but cancel everything else.
    // Or we can just cancel everything, and then we will launch a fresh cycle!
    // Let's cancel all active runs except the two we just spawned.
    // Wait, let's look up what the IDs of our new runs are. They are 3419 and 3420.
    const keepIds = [3419, 3420];
    
    const result = await db.update(missionRuns)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(
            and(
                inArray(missionRuns.status, ['active', 'running', 'waiting_on_human', 'waiting_on_file']),
                notInArray(missionRuns.id, keepIds)
            )
        );
        
    console.log("Cleanup complete. Queue unblocked.");
    process.exit(0);
}

cleanup().catch(e => {
    console.error(e);
    process.exit(1);
});
