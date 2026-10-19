import { db } from "../database_service.js";
import { operationalCycles, missionRuns } from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";

async function completeCycle1Runs() {
    try {
        console.log("=== COMPLETING CYCLE 1 MISSION RUNS ===");

        await db.update(missionRuns)
            // mission_runs has no metadata column, so the annotation this script
            // used to pass was never persisted. Completion is what it is for.
            .set({ status: "completed" })
            .where(inArray(missionRuns.id, [28, 29, 30]));

        console.log("✓ Updated Mission Runs #28, #29, and #30 to 'completed'.");

        await db.update(operationalCycles)
            .set({
                status: "active",
                updatedAt: new Date()
            })
            .where(eq(operationalCycles.id, 1));

        console.log("✓ Updated Cycle 1 status to 'active'.");

        const updatedRuns = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, 1));
        console.log("\n=== FINAL CYCLE 1 RUNS STATUS ===");
        console.log(JSON.stringify(updatedRuns.map(r => ({ id: r.id, name: r.name, status: r.status })), null, 2));
    } catch (err: any) {
        console.error("Completion error:", err.message);
    }
    process.exit(0);
}

completeCycle1Runs();
