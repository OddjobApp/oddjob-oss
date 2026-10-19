
import { db } from "../server/database_service.js";
import { missionRuns } from "../shared/schema/index.js";
import { inArray } from "drizzle-orm";

async function main() {
    const ids = [2088, 2089, 2090, 2091, 2092, 2093];
    for (const id of ids) {
        const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, id)).limit(1);
        if (run) {
            const context = run.missionContext as any;
            await db.update(missionRuns).set({ 
                status: 'active',
                missionContext: { ...context, phase: 'PLANNING' },
                createdAt: new Date(),
                updatedAt: new Date(),
                lastCheckpointAt: new Date()
            }).where(eq(missionRuns.id, id));
            console.log(`Reset mission ${id} to active PLANNING`);
        }
    }
    process.exit(0);
}

import { eq } from "drizzle-orm";
main().catch(console.error);
