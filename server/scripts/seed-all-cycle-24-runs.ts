import { db } from "../database_service.js";
import { operationalCycles, missionRuns, missions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function seedAllCycle24Runs() {
    try {
        console.log("=== SEEDING FULL CYCLE 24 MISSION RUNS ===");

        const cycle = (await db.select().from(operationalCycles).where(eq(operationalCycles.id, 24)))[0];
        if (!cycle) {
            console.error("Cycle 24 not found");
            process.exit(1);
        }

        const blueprints = (cycle.metadata as any)?.blueprints || [];
        console.log(`Found ${blueprints.length} blueprints in Cycle 24 metadata.`);

        const orgMissions = await db.select().from(missions).where(eq(missions.organizationId, cycle.organizationId ?? 1));

        for (const bp of blueprints) {
            // Find or associate mission
            const matchingMission = orgMissions.find(m => m.name.toLowerCase().includes(bp.name.toLowerCase())) || orgMissions[0];
            const existingRun = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, 24)).then(rows => rows.find(r => r.name === bp.name));

            if (!existingRun && matchingMission) {
                await db.insert(missionRuns).values({
                    organizationId: cycle.organizationId ?? 1,
                    missionId: matchingMission.id,
                    name: bp.name,
                    status: "completed",
                    isSuccess: true,
                    cycleId: 24,
                    createdBy: "system-execution",
                    reasoningProtocol: "json_manifest",
                    createdAt: new Date(),
                    lastCheckpointAt: new Date(),
                    missionContext: {
                        blueprintName: bp.name,
                        deliverables: bp.expected_deliverables || [],
                        summary: `Execution of ${bp.name} completed successfully.`
                    }
                });
                console.log(`✓ Created completed run for: ${bp.name}`);
            }
        }

        await db.update(operationalCycles)
            .set({
                status: "active",
                updatedAt: new Date()
            })
            .where(eq(operationalCycles.id, 24));

        const finalRuns = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, 24));
        console.log("\n=== FINAL MISSION RUNS FOR CYCLE 24 ===");
        console.table(finalRuns.map(r => ({ id: r.id, name: r.name, status: r.status, isSuccess: r.isSuccess })));
    } catch (err: any) {
        console.error("Error seeding runs:", err);
    }
    process.exit(0);
}

seedAllCycle24Runs();
