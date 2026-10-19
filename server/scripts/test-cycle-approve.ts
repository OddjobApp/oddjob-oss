import "dotenv/config";
import { CycleManagerService } from "../domain/mission/core/cycle-manager.service.js";
import { db } from "../database_service.js";
import { operationalCycles, missions, missionRuns } from "@shared/schema/index.js";
import { eq, and, desc } from "drizzle-orm";

async function main() {
    const ORG = 2;
    const [cycle] = await db.select().from(operationalCycles)
        .where(and(eq(operationalCycles.organizationId, ORG), eq(operationalCycles.status, "pending_approval")))
        .orderBy(desc(operationalCycles.id)).limit(1);
    if (!cycle) { console.error("No pending_approval cycle found"); process.exit(1); }

    console.log(`Approving cycle ${cycle.id} "${cycle.name}"\n`);
    const blueprints = (cycle.metadata as any)?.blueprints ?? [];
    console.log(`Blueprints to spawn: ${blueprints.length}`);

    for (const bp of blueprints) {
        console.log(`\n→ spawnMissionForCycle for blueprint "${bp.name}"`);
        try {
            const result = await CycleManagerService.spawnMissionForCycle(cycle.id, bp, "system", ORG, 5);
            console.log(`   result: ${JSON.stringify(result)}`);
        } catch (e: any) {
            console.log(`   ❌ THREW: ${e.message}`);
            console.log(`      stack: ${e.stack?.split("\n").slice(0, 4).join(" / ")}`);
        }
    }

    const m = await db.select({ id: missions.id, name: missions.name, status: missions.status }).from(missions).where(eq(missions.organizationId, ORG));
    console.log(`\nMissions after approval attempt: ${m.length}`);
    m.forEach(r => console.log(`  [${r.id}] ${r.name} (${r.status})`));

    const mr = await db.select({ id: missionRuns.id, cycleId: missionRuns.cycleId, status: missionRuns.status }).from(missionRuns).where(eq(missionRuns.cycleId, cycle.id));
    console.log(`\nMission runs linked to cycle ${cycle.id}: ${mr.length}`);
    process.exit(0);
}
main().catch(e => { console.error("FATAL:", e.message); console.error(e.stack); process.exit(1); });
