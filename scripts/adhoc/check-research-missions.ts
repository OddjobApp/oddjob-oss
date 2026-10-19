
import { db } from '../../server/database_service.js';
import { missionRuns } from '../../shared/schema/index.js';
import { desc, inArray, gte } from 'drizzle-orm';

async function checkRuns() {
    try {
        const runs = await db.select().from(missionRuns).where(gte(missionRuns.id, 728)).orderBy(desc(missionRuns.id));
        console.table(runs.map((r: any) => ({
            ID: r.id,
            Strategy: (r.missionContext as any)?.executionStrategy || 'unknown',
            Status: r.status,
            Phase: (r.missionContext as any)?.phase || 'none',
            Wave: (r.missionContext as any)?.current_wave || 'none',
            Updated: r.updatedAt.toISOString().split('T')[1].split('.')[0],
            Error: r.failureReason ? r.failureReason.substring(0, 50) : 'none'
        })));

        const { missionDeliverables } = await import('../../shared/schema/index.js');
        const deliverables = await db.select().from(missionDeliverables).where(gte(missionDeliverables.missionRunId, 728));
        console.log("\n--- DELIVERABLES ---");
        console.table(deliverables.map((d: any) => ({ ID: d.id, RunID: d.missionRunId, Name: d.name })));
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

checkRuns();
