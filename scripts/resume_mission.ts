
import { db } from "../server/database_service.js";
import { missionRuns } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";
import { queueMissionCycle } from "../server/domain/mission/infrastructure/dynamic-mission-queue.js";

const runId = parseInt(process.argv[2]);
const userId = "54dda4de-c575-4fa1-b7e1-c1891e288beb"; // Default admin user

async function resume() {
    if (isNaN(runId)) {
        console.error("Usage: npx tsx scripts/resume_mission.ts <runId>");
        process.exit(1);
    }

    console.log(`Resuming run ${runId}...`);
    
    // Reset status to active
    await db.update(missionRuns)
        .set({ 
            status: 'active', 
            failureReason: null,
            updatedAt: new Date()
        })
        .where(eq(missionRuns.id, runId));

    // Queue initial cycle
    await queueMissionCycle({ missionRunId: runId, userId, orgId: null }, 0);
    
    console.log(`Run ${runId} has been reset to active and queued for execution.`);
    process.exit(0);
}

resume().catch(err => {
    console.error(err);
    process.exit(1);
});
