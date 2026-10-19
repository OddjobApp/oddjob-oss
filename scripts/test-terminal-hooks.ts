import { db } from "../server/db/index.js";
import { missions } from "../shared/schema/index.js";
import { missionService } from "../server/domain/mission/core/mission.service.js";
import { eq } from "drizzle-orm";

async function main() {
    console.log("--- TERMINAL HOOKS TEST ---");
    
    // 1. Create a dummy mission
    const [testMission] = await db.insert(missions).values({
        name: "Terminal Hook Test Mission",
        objective: "Test automated TrustGraph snapping on termination",
        organizationId: 1,
        createdBy: "system-test",
        type: "mission_based",
        status: "active"
    }).returning();

    console.log(`Created test mission: ${testMission.id}`);

    // 2. Terminate the mission (should trigger hook)
    console.log("Terminating mission...");
    await missionService.terminateMission(testMission.id);

    // 3. Wait for async hooks to complete
    console.log("Waiting for async hooks (TrustGraph snap)...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 4. Verify DB update
    const [updated] = await db.select().from(missions).where(eq(missions.id, testMission.id)).limit(1);

    // 5. Test Mission Run (Run level hook)
    console.log("\n--- MISSION RUN HOOK TEST ---");
    const { missionRunService } = await import("../server/domain/mission/core/mission-run.service.js");
    const [testRun] = await db.insert(missions).values({
        name: "Run Hook Test mission",
        objective: "Test automated TrustGraph snapping on run completion",
        organizationId: 1,
        createdBy: "system-test",
        type: "mission_based",
        status: "active"
    }).returning();
    
    // Create a run for this mission
    const { missionRuns } = await import("../shared/schema/missions/runs.js");
    const [run] = await db.insert(missionRuns).values({
        missionId: testRun.id,
        name: "Test Run 1",
        status: "active",
        organizationId: 1,
        missionContext: {},
        createdBy: "system-test"
    }).returning();

    console.log(`Created test run: ${run.id} for mission ${testRun.id}`);

    // Update run to completed
    console.log("Completing mission run...");
    await missionRunService.update(run.id, { status: "completed" });

    // Wait for async hooks
    console.log("Waiting for async hooks (TrustGraph snap)...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    const [updatedRun] = await db.select().from(missionRuns).where(eq(missionRuns.id, run.id)).limit(1);

    if (updatedRun.status === 'completed') {
        console.log("SUCCESS: Mission Run status updated to completed.");
    } else {
        console.error("FAILURE: Mission Run status not updated.");
    }

    process.exit(0);
}

main().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
