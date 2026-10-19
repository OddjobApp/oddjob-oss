import { db } from "../database_service.js";
import { operationalCycles, missionRuns } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function inspectCycle() {
    try {
        const cycleList = await db.select().from(operationalCycles).where(eq(operationalCycles.id, 5));
        console.log("=== OPERATIONAL CYCLE 5 RECORD ===");
        console.log(JSON.stringify(cycleList, null, 2));

        if (cycleList.length > 0) {
            const cycle = cycleList[0];
            console.log("\nName:", cycle.name);
            console.log("Status:", cycle.status);
            console.log("Objective:", cycle.objective);
            console.log("Blueprints Count:", (cycle.metadata as any)?.blueprints?.length || 0);
        }

        const runList = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, 5));
        console.log("\n=== CYCLE 5 MISSION RUNS ===");
        console.log(JSON.stringify(runList.map(r => ({ id: r.id, name: r.name, status: r.status, createdAt: r.createdAt })), null, 2));
    } catch (err: any) {
        console.error("DB Error:", err.message);
    }
    process.exit(0);
}

inspectCycle();
