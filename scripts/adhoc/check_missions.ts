import { db } from "../../server/database_service.js";
import { missionRuns } from "../../shared/schema/index.js";
import { desc } from "drizzle-orm";

async function checkMissions() {
    try {
        console.log("--- Recent Missions ---");
        const missions = await db.select().from(missionRuns).orderBy(desc(missionRuns.createdAt)).limit(5);
        console.log(JSON.stringify(missions, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkMissions();
