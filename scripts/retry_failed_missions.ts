
import { db } from "../server/database_service.js";
import { missionRuns } from "../shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";
import { queueMissionCycle } from "../server/domain/mission/infrastructure/dynamic-mission-queue.js";

async function retry() {
    const runIds = [2082, 2083, 2084, 2085, 2086, 2087];
    const now = new Date();
    console.log(`Resetting and retrying runs: ${runIds.join(', ')} (Timestamp: ${now.toISOString()})`);
    
    await db.update(missionRuns)
        .set({ 
            status: 'active', 
            failureReason: null,
            createdAt: now,
            updatedAt: now,
            lastCheckpointAt: now
        })
        .where(inArray(missionRuns.id, runIds));
        
    for (const runId of runIds) {
        const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);
        if (run) {
            console.log(`Re-queueing run ${runId}`);
            await queueMissionCycle({
                missionRunId: runId,
                userId: run.createdBy || "agent",
                orgId: run.organizationId
            }, 5000); // Add 5s delay to avoid throttler immediate reject
        }
    }
    
    process.exit(0);
}

retry().catch(console.error);
