import { db } from "../database_service.js";
import { operationalCycles, missionRuns } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function checkCycle24() {
    try {
        const cycle = await db.select().from(operationalCycles).where(eq(operationalCycles.id, 24));
        const runs = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, 24));

        console.log("=== CYCLE 24 STATUS ===");
        console.log("Name:", cycle[0]?.name);
        console.log("Status:", cycle[0]?.status);
        console.log("\n=== MISSION RUNS FOR CYCLE 24 ===");
        console.log(JSON.stringify(runs.map(r => ({
            id: r.id,
            missionId: r.missionId,
            name: r.name,
            status: r.status,
            createdAt: r.createdAt
        })), null, 2));
    } catch (err: any) {
        console.error("Error:", err.message);
    }
    process.exit(0);
}

checkCycle24();
