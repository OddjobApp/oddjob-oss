
import { db } from "../../server/database_service.js";
import { missions } from "../../shared/schema/index.js";
import { desc } from 'drizzle-orm';

async function checkRecentMissions() {
    const recentMissions = await db.select({
        id: missions.id,
        name: missions.name,
        strategy: missions.executionStrategy,
        createdAt: missions.createdAt
    })
    .from(missions)
    .orderBy(desc(missions.id))
    .limit(10);

    console.log('📊 Recent Missions:');
    console.table(recentMissions);
}

checkRecentMissions().catch(console.error);
