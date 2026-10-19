import { db } from "../database_service.js";
import { operationalCycles, missionRuns, missions } from "@shared/schema/index.js";
import { CycleManagerService } from "../domain/mission/core/cycle-manager.service.js";
import { eq } from "drizzle-orm";

async function inspectCycle24() {
    try {
        console.log("=== INSPECTING CYCLE 24 ===");
        const cycles = await db.select().from(operationalCycles).where(eq(operationalCycles.id, 24));
        if (cycles.length === 0) {
            console.error("Cycle 24 not found.");
            process.exit(1);
        }
        const cycle = cycles[0];
        console.log("Name:", cycle.name);
        console.log("Status:", cycle.status);
        console.log("Metadata:", JSON.stringify(cycle.metadata, null, 2));

        const cycleMissions = await db.select().from(missions).where(eq(missions.organizationId, cycle.organizationId ?? 1));
        console.log("Found missions for org:", cycleMissions.length);

        const runs = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, 24));
        console.log("Mission runs for Cycle 24:", runs.length);
        console.log(JSON.stringify(runs, null, 2));

        // If cycle has blueprints in metadata, let's check
        const blueprints = (cycle.metadata as any)?.blueprints || [];
        console.log("Blueprints count:", blueprints.length);

        if (runs.length === 0 && blueprints.length > 0) {
            console.log("Spawning blueprints for Cycle 24...");
            await db.update(operationalCycles)
                .set({ status: "active", updatedAt: new Date() })
                .where(eq(operationalCycles.id, 24));
            
            await CycleManagerService.spawnBlueprintsWithDeps(
                cycle.id,
                blueprints,
                "system-execution",
                cycle.organizationId ?? 1,
                cycle.priority ?? 5
            );
            console.log("✓ Spawned blueprints!");

            const newRuns = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, 24));
            console.log("New Mission Runs count:", newRuns.length);
            console.log(JSON.stringify(newRuns.map(r => ({ id: r.id, name: r.name, status: r.status })), null, 2));
        }
    } catch (err: any) {
        console.error("Error:", err);
    }
    process.exit(0);
}

inspectCycle24();
