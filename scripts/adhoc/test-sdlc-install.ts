import "dotenv/config";
import { appRegistryService } from "../../server/domain/apps/app-registry.service.js";
import { db } from "../../server/database_service.js";
import { operationalCycles, cycleBlueprints } from "@shared/schema/index.js";
import { eq, and, desc } from "drizzle-orm";

async function main() {
    console.log("[TEST] Starting SDLC install end-to-end test...");

    // Install SDLC app (id=73) into Org 1
    const APP_ID = 73;
    const ORG_ID = 1;

    console.log(`[TEST] Calling installApp(${APP_ID}, ${ORG_ID})`);
    const result = await appRegistryService.installApp(APP_ID, ORG_ID);
    console.log(`[TEST] installApp returned. Deployment ID: ${result.deployment?.id}, hasToken: ${!!result.appToken}`);

    // Verify the operational cycle was created
    const cycles = await db
        .select()
        .from(operationalCycles)
        .where(eq(operationalCycles.organizationId, ORG_ID))
        .orderBy(desc(operationalCycles.createdAt))
        .limit(3);

    console.log(`[TEST] Cycles for org ${ORG_ID} after install (latest 3):`);
    cycles.forEach((c: any) => console.log(`  - [${c.id}] "${c.name}" status=${c.status}`));

    const sdlcCycle = cycles.find((c: any) => c.name.includes("Hybrid AI SDLC") || c.name.includes("SDLC"));
    if (!sdlcCycle) {
        console.error("[FAIL] No SDLC cycle found after install!");
        process.exit(1);
    }

    console.log(`[TEST] Found SDLC cycle: id=${sdlcCycle.id}, status=${sdlcCycle.status}`);

    // Verify blueprints were created
    const blueprints = await db
        .select()
        .from(cycleBlueprints)
        .where(eq(cycleBlueprints.cycleId, sdlcCycle.id));

    console.log(`[TEST] Blueprints for cycle ${sdlcCycle.id}: ${blueprints.length} rows`);
    blueprints.slice(0, 3).forEach((b: any) => console.log(`  - "${b.name}" type=${b.type}`));

    if (blueprints.length === 0) {
        console.error("[FAIL] No blueprints created for the cycle!");
        process.exit(1);
    }

    console.log("[PASS] End-to-end install succeeded:");
    console.log(`  Deployment ID: ${result.deployment.id}`);
    console.log(`  Cycle ID: ${sdlcCycle.id}, Status: ${sdlcCycle.status}`);
    console.log(`  Blueprints: ${blueprints.length}`);
    process.exit(0);
}

main().catch(err => {
    console.error("[FAIL] Unexpected error:", err.message);
    console.error(err.stack);
    process.exit(1);
});
