import { db } from "../server/db/index.js";
import { missionRuns, pipelineExecutions } from "@shared/schema/index.js";
import { missionRunService } from "../server/domain/mission/core/mission-run.service.js";
import { eq, isNull, isNotNull } from "drizzle-orm";

async function verify() {
    console.log("🧪 Starting Soft Delete Verification...");

    // 1. Create a dummy run
    console.log("Creating test mission run...");
    const run = await missionRunService.create({
        missionId: 33,
        name: "Soft Delete Test Run",
        pipelineSequence: [1],
        createdBy: "verifier"
    });
    console.log(`Created Run ID: ${run.id}`);

    // 2. Verify it's in the list
    const listBefore = await missionRunService.list({ missionId: 33 });
    const foundBefore = listBefore.some(r => r.id === run.id);
    console.log(`Found in list before delete: ${foundBefore}`);

    // 3. Perform Soft Delete
    console.log("Performing soft delete...");
    await missionRunService.delete(run.id);

    // 4. Verify it's GONE from the list
    const listAfter = await missionRunService.list({ missionId: 33 });
    const foundAfter = listAfter.some(r => r.id === run.id);
    console.log(`Found in list after delete: ${foundAfter}`);

    // 5. Verify it's STILL in the DB with deletedAt
    const rawRun = await db.select().from(missionRuns).where(eq(missionRuns.id, run.id)).limit(1).then(r => r[0]);
    console.log(`Raw DB check: ID=${rawRun?.id}, deletedAt=${rawRun?.deletedAt}`);

    if (!foundAfter && rawRun?.deletedAt) {
        console.log("✅ SOFT DELETE VERIFIED: Record preserved in DB but hidden from service!");
    } else {
        console.error("❌ SOFT DELETE FAILED!");
    }

    process.exit(0);
}

verify().catch(err => {
    console.error("❌ Verification failed:", err);
    process.exit(1);
});
