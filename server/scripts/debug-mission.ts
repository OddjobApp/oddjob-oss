// @ts-nocheck
import { db } from "../database_service.js";
import { eq, desc } from "drizzle-orm";
// Using relative paths to avoid tsconfig-paths issues with tsx in some environments
import { missions, missionRuns, missionBlackboardHistory } from "../schema.js";

async function debug(missionId: number) {
    console.log(`--- Debugging Mission ${missionId} ---`);

    try {
        // Check Mission / Blackboard
        const [mission] = await db.select()
            .from(missions)
            .where(eq(missions.id, missionId))
            .limit(1);

        if (!mission) {
            console.log(`Mission ${missionId} not found.`);
        } else {
            console.log("Current Mission Blackboard Content:");
            console.log(JSON.stringify(mission.blackboard, null, 2));
        }

        // Check Mission Runs
        const activeRuns = await db.select()
            .from(missionRuns)
            .where(eq(missionRuns.missionId, missionId))
            .orderBy(desc(missionRuns.updatedAt));

        console.log(`\nFound ${activeRuns.length} mission runs for Mission ${missionId}.`);
        activeRuns.forEach(r => {
            console.log(`- Run ID: ${r.id}, Status: ${r.status}, Pipeline ID: ${r.pipelineExecutionId}, Updated At: ${r.updatedAt}`);
            if (r.missionContext) {
                console.log(`  Last User Guidance: ${(r.missionContext as any).lastUserGuidance}`);
            }
        });

        // Also check if there is a mission run with ID = missionId (in case user meant Run ID 69)
        const [runById] = await db.select()
            .from(missionRuns)
            .where(eq(missionRuns.id, missionId))
            .limit(1);

        if (runById) {
            console.log(`\nFound Mission Run by ID ${missionId}:`);
            console.log(`- Status: ${runById.status}, Mission ID: ${runById.missionId}, Updated At: ${runById.updatedAt}`);
        }

        // Check Blackboard History
        const history = await db.select()
            .from(missionBlackboardHistory)
            .where(eq(missionBlackboardHistory.missionId, missionId))
            .orderBy(desc(missionBlackboardHistory.createdAt))
            .limit(5);

        console.log("\nRecent Blackboard History:");
        history.forEach(h => {
            console.log(`- Changed By: ${h.changedBy}, Reason: ${h.changeReason}, Created At: ${h.createdAt}`);
        });
    } catch (err: any) {
        console.error("Database debug failed:");
        console.error(err);
    }
}

// Support both positional and --id arg
let missionId = 68;
const args = process.argv.slice(2);
const idIdx = args.indexOf('--id');
if (idIdx !== -1 && args[idIdx + 1]) {
    missionId = parseInt(args[idIdx + 1]);
} else if (args[0] && !args[0].startsWith('--')) {
    missionId = parseInt(args[0]);
}

debug(missionId).then(() => {
    // Small delay to ensure logs flush
    setTimeout(() => process.exit(0), 100);
}).catch(err => {
    console.error(err);
    process.exit(1);
});

