import { db } from "../server/db/index.js";
import { missionRuns } from "../shared/schema/index.js";
import { inArray } from "drizzle-orm";

async function checkMissions() {
    const runs = await db.select().from(missionRuns).where(inArray(missionRuns.id, [268, 269, 270]));
    console.log(JSON.stringify(runs, null, 2));
    process.exit(0);
}

checkMissions().catch(console.error);
