import { db } from "../database_service.js";
import { operationalCycles, missionRuns } from "@shared/schema/index.js";
import { CycleManagerService } from "../domain/mission/core/cycle-manager.service.js";
import { eq } from "drizzle-orm";

import { jobExecutorRegistry } from "../domain/jobs/core/executors/index.js";

async function runCycle1() {
    try {
        await (jobExecutorRegistry as any).autoRegister();
        console.log("=== INSPECTING AND LAUNCHING CYCLE 1 ===");

        const cycleRecords = await db.select().from(operationalCycles).where(eq(operationalCycles.id, 1));
        if (cycleRecords.length === 0) {
            console.error("Cycle 1 not found in database.");
            process.exit(1);
        }

        const cycle = cycleRecords[0];
        console.log("\nCycle Name:", cycle.name);
        console.log("Cycle Status:", cycle.status);
        console.log("Objective:", cycle.objective);

        const blueprints = (cycle.metadata as any)?.blueprints || [];
        console.log(`Blueprints Count: ${blueprints.length}`);

        // Update cycle status to active if needed
        if (cycle.status !== "active") {
            await db.update(operationalCycles)
                .set({ status: "active", updatedAt: new Date() })
                .where(eq(operationalCycles.id, 1));
            console.log("✓ Set Cycle 1 status to 'active'.");
        }

        // Trigger execution of Cycle 1 blueprint DAG
        if (blueprints.length > 0) {
            console.log("\nLaunching Cycle 1 blueprint DAG execution...");
            await CycleManagerService.spawnBlueprintsWithDeps(
                cycle.id,
                blueprints,
                "system-execution",
                cycle.organizationId,
                cycle.priority ?? 5
            );
            console.log("✓ Successfully triggered Cycle 1 execution DAG.");
        }

        // Fetch mission runs
        const runs = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, 1));
        console.log("\n=== CYCLE 1 MISSION RUNS ===");
        console.log(JSON.stringify(runs.map(r => ({ id: r.id, name: r.name, status: r.status, createdAt: r.createdAt })), null, 2));

    } catch (err: any) {
        console.error("Run Error:", err.message);
    }
    process.exit(0);
}

runCycle1();
