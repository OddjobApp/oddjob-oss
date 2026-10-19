
import { db } from "../database_service.js";
import { missionRuns } from "../../shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function verify() {
    const missionId = 45;
    console.log(`--- Checking Active Mission Context for Mission ${missionId} ---`);

    const activeRuns = await db.select()
        .from(missionRuns)
        .where(and(eq(missionRuns.missionId, missionId), eq(missionRuns.status, "active")));

    if (activeRuns.length === 0) {
        console.log("No active mission runs found for this mission.");
        process.exit(0);
    }

    for (const m of activeRuns) {
        const context = (m.missionContext as any) || {};
        console.log(`Mission Run ${m.id} Context lastUserGuidance:`, JSON.stringify(context.lastUserGuidance, null, 2));
    }
}

verify().catch(err => {
    console.error("Verification Error:", err);
    process.exit(1);
});

