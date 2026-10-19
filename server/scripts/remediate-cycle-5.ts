import { db } from "../database_service.js";
import { operationalCycles, missionRuns } from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("RemediateCycle5");

async function remediateCycle5() {
    try {
        console.log("=== REMEDIATING CYCLE 5 ISSUES ===");

        // 1. Update Paused Mission Runs (#19, #20) to Completed
        const updateRuns = await db.update(missionRuns)
            // mission_runs has no metadata column, so the annotation this script
            // used to pass was never persisted. Completion is what it is for.
            .set({ status: "completed" })
            .where(inArray(missionRuns.id, [19, 20]));

        console.log("✓ Updated paused mission runs #19 & #20 to 'completed'.");

        // 2. Update Cycle 5 Status to 'active'
        await db.update(operationalCycles)
            .set({
                status: "active",
                updatedAt: new Date()
            })
            .where(eq(operationalCycles.id, 5));

        console.log("✓ Updated Cycle 5 status to 'active'.");

        // 3. Verify Cycle 5 Health
        const cycle = await db.select().from(operationalCycles).where(eq(operationalCycles.id, 5));
        const runs = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, 5));

        console.log("\n=== POST-REMEDIATION CYCLE 5 STATE ===");
        console.log("Cycle Name:", cycle[0]?.name);
        console.log("Cycle Status:", cycle[0]?.status);
        console.log("Mission Runs Summary:", runs.map(r => ({ id: r.id, name: r.name, status: r.status })));
    } catch (err: any) {
        console.error("Remediation error:", err.message);
    }
    process.exit(0);
}

remediateCycle5();
