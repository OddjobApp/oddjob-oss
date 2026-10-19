
import { db } from "../server/database_service.js";
import { missionRuns } from "../shared/schema/index.js";
import { desc, inArray } from "drizzle-orm";

async function main() {
    console.log("📊 Sequential Mission Monitor (Focused)");
    console.log("----------------------------");

    const runs = await db.select()
        .from(missionRuns)
        .where(inArray(missionRuns.id, [2088, 2089, 2090, 2091, 2092, 2093]))
        .orderBy(desc(missionRuns.createdAt));

    for (const run of runs) {
        console.log(`Run ID: ${run.id} | Status: ${run.status} | Created: ${run.createdAt}`);
        console.log(`Phase: ${(run.missionContext as any)?.phase}`);
        console.log(`Wave: ${(run.missionContext as any)?.current_wave}`);
        console.log(`Trace Summary:`);
        const trace = run.dynamicTrace as any[] || [];
        trace.forEach(t => {
            console.log(`  [${t.timestamp}] ${t.type} - ${t.event}: ${t.note || t.error || ''}`);
            if (t.event === 'blueprint_created') {
                console.log(`    BLUEPRINT: ${JSON.stringify(t.note, null, 2)}`);
            }
        });
        console.log("----------------------------");
    }

    process.exit(0);
}

main().catch(console.error);
