import { db } from "../server/database_service.js";
import { operationalCycles } from "../shared/schema/index.js";
import { CycleManagerService } from "../server/domain/mission/core/cycle-manager.service.js";
import { eq } from "drizzle-orm";

async function main() {
    const cycleId = 42;
    try {
        const [cycle] = await db.select().from(operationalCycles).where(eq(operationalCycles.id, cycleId)).limit(1);
        if (!cycle) {
            console.error("Cycle 42 not found");
            process.exit(1);
        }

        const metadata = cycle.metadata as any;
        const blueprints = metadata?.blueprints;

        if (!blueprints || !Array.isArray(blueprints) || blueprints.length === 0) {
            console.error("No blueprints found for Cycle 42");
            process.exit(1);
        }

        console.log(`Triggering execution for Cycle 42 with ${blueprints.length} blueprints...`);
        
        // spawnBlueprintsWithDeps(cycleId, blueprints, userId, orgId, priority)
        await CycleManagerService.spawnBlueprintsWithDeps(
            cycleId,
            blueprints,
            "antigravity", // createdBy
            1, // orgId
            3 // priority
        );

        console.log("Successfully triggered cycle execution!");
    } catch (error) {
        console.error("Failed to trigger cycle execution:", error);
    }
    process.exit(0);
}

main();
