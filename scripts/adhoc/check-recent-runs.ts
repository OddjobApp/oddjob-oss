
import { db } from '../../server/database_service.js';
import { missionRuns, missions } from '../../shared/schema/index.js';
import { desc, eq } from 'drizzle-orm';

async function checkRecentMissions() {
    const recentRuns = await db.select({
        runId: missionRuns.id,
        missionId: missionRuns.missionId,
        status: missionRuns.status,
        strategy: missions.executionStrategy,
        name: missions.name,
        createdAt: missionRuns.createdAt
    })
    .from(missionRuns)
    .innerJoin(missions, eq(missionRuns.missionId, missions.id))
    .orderBy(desc(missionRuns.createdAt))
    .limit(5);

    console.log('📊 Recent Mission Runs:');
    console.table(recentRuns);
}

checkRecentMissions().catch(console.error);
