import { db } from "../database_service.js";
import { missionRuns, pipelineExecutions } from "@shared/schema/index.js";
import { eq, and, inArray } from "drizzle-orm";

async function syncMissions() {
    console.log("Starting mission status synchronization...");

    // 1. Find active mission runs with completed pipelines
    const completedExecs = await db.select({
        runId: missionRuns.id,
        peStatus: pipelineExecutions.status
    })
    .from(missionRuns)
    .innerJoin(pipelineExecutions, eq(missionRuns.pipelineExecutionId, pipelineExecutions.id))
    .where(and(
        eq(missionRuns.status, "active"),
        inArray(pipelineExecutions.status, ["completed", "success"])
    ));

    console.log(`Found ${completedExecs.length} missions with completed pipelines but active status.`);
    for (const exec of completedExecs) {
        await db.update(missionRuns)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(missionRuns.id, exec.runId));
        console.log(`Updated mission run ${exec.runId} to 'completed'.`);
    }

    // 2. Find active mission runs with failed pipelines
    const failedExecs = await db.select({
        runId: missionRuns.id,
        peStatus: pipelineExecutions.status
    })
    .from(missionRuns)
    .innerJoin(pipelineExecutions, eq(missionRuns.pipelineExecutionId, pipelineExecutions.id))
    .where(and(
        eq(missionRuns.status, "active"),
        eq(pipelineExecutions.status, "failed")
    ));

    console.log(`Found ${failedExecs.length} missions with failed pipelines but active status.`);
    for (const exec of failedExecs) {
        await db.update(missionRuns)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(missionRuns.id, exec.runId));
        console.log(`Updated mission run ${exec.runId} to 'failed'.`);
    }

    // 3. Optional: Cleanup orphans (no execution ID for > 24h)
    // For now, let's just stick to the certain ones.

    console.log("Synchronization complete.");
    process.exit(0);
}

syncMissions().catch(err => {
    console.error("Sync failed:", err);
    process.exit(1);
});

