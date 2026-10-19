import { db } from './server/database_service.js';
import { missions, missionRuns } from './shared/schema/index.js';
import { eq } from 'drizzle-orm';

async function check() {
    const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, 464)).limit(1);
    console.log('Run:', JSON.stringify(run, null, 2));
    
    if (run.missionId) {
        const [mission] = await db.select().from(missions).where(eq(missions.id, run.missionId)).limit(1);
        console.log('Mission:', JSON.stringify(mission, null, 2));
    }
    process.exit(0);
}

check().catch(console.error);
