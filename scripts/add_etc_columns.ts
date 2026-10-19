import { db } from "../server/db/index.js";
import { sql, eq } from 'drizzle-orm';
import { missionRuns } from '@shared/schema/missions';

async function run() {
    try {
        await db.execute(sql`ALTER TABLE pipeline_executions ADD COLUMN IF NOT EXISTS estimated_time_remaining_ms INTEGER;`);
        await db.execute(sql`ALTER TABLE pipeline_executions ADD COLUMN IF NOT EXISTS last_etc_calculation_at TIMESTAMP;`);
        console.log('Columns added');

        // Also fetch the mission 73 runs
        const runs = await db.select().from(missionRuns).where(eq(missionRuns.missionId, 73));
        console.log("Mission 73 runs:", JSON.stringify(runs, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}
run();
