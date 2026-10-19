
import { db } from "../server/database_service.js";
import { missionRuns } from "../shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";

async function checkMissions() {
    const ids = [728, 729, 730, 731, 732];
    const results = await db.select().from(missionRuns).where(inArray(missionRuns.id, ids));
    
    console.log("RESEARCH MISSIONS STATUS:");
    results.forEach((r: any) => {
        console.log(`Run ${r.id}: ${r.status} | Updated: ${r.updatedAt} | Context Result: ${!!(r.missionContext as any)?.result}`);
    });
    process.exit(0);
}

checkMissions().catch(err => {
    console.error(err);
    process.exit(1);
});
