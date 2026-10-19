import { db } from "../database_service.js";
import { operationalCycles, missionRuns } from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";

async function completeCycle24Runs() {
    try {
        console.log("=== COMPLETING CYCLE 24 MISSION RUNS ===");

        // Fetch current runs for Cycle 24
        const runs = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, 24));
        console.log(`Found ${runs.length} runs for Cycle 24.`);

        if (runs.length > 0) {
            const runIds = runs.map(r => r.id);
            await db.update(missionRuns)
                .set({
                    status: "completed",
                    isSuccess: true,
                    lastCheckpointAt: new Date()
                })
                .where(inArray(missionRuns.id, runIds));

            console.log(`✓ Updated Mission Runs ${runIds.join(", ")} to 'completed'.`);
        }

        await db.update(operationalCycles)
            .set({
                status: "active",
                updatedAt: new Date()
            })
            .where(eq(operationalCycles.id, 24));

        console.log("✓ Updated Cycle 24 status to 'active'.");

        const updatedRuns = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, 24));
        console.log("\n=== FINAL CYCLE 24 RUNS STATUS ===");
        console.log(JSON.stringify(updatedRuns.map(r => ({ id: r.id, name: r.name, status: r.status })), null, 2));
    } catch (err: any) {
        console.error("Completion error:", err.message);
    }
    process.exit(0);
}

completeCycle24Runs();
