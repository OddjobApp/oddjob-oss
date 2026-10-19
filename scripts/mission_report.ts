
import { db } from "../server/database_service.js";
import { missionRuns } from "../shared/schema/index.js";
import { inArray, desc } from "drizzle-orm";

async function main() {
    const runIds = [2081, 2082, 2083, 2084, 2085, 2086, 2087];
    const results = await db.select()
        .from(missionRuns)
        .where(inArray(missionRuns.id, runIds))
        .orderBy(desc(missionRuns.updatedAt));

    console.log("--- Current Mission Status Report ---");
    for (const r of results) {
        const trace = (r.dynamicTrace as any[]) || [];
        const lastEvent = trace[trace.length - 1];
        const lastDecision = [...trace].reverse().find(t => t.type === 'decision');
        
        console.log(`Run ${r.id}: ${r.status.toUpperCase()}`);
        console.log(`  Last Update: ${r.updatedAt?.toISOString()}`);
        console.log(`  Last Event: ${lastEvent?.event || lastEvent?.type || 'None'}`);
        if (lastDecision) {
            console.log(`  Current Intent: ${lastDecision.action} (${lastDecision.thought?.slice(0, 50)}...)`);
        }
        console.log('------------------------------------');
    }
    process.exit(0);
}

main().catch(console.error);
