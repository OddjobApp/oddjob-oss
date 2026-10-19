
import { db } from "../server/database_service.js";
import { missionBlackboardHistory } from "../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function main() {
    const missionId = parseInt(process.argv.find(arg => arg.startsWith('--mission-id'))?.split('=')[1] || "0");
    if (!missionId) {
        process.exit(1);
    }

    const history = await db.select()
        .from(missionBlackboardHistory)
        .where(eq(missionBlackboardHistory.missionId, missionId))
        .orderBy(desc(missionBlackboardHistory.createdAt))
        .limit(20);

    console.log(`--- Blackboard History for Mission ${missionId} ---`);
    console.log(JSON.stringify(history, null, 2));
    process.exit(0);
}

main().catch(console.error);
