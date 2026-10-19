import "dotenv/config";
import { db } from "../server/db/index.js";
import { missions, orgs } from "@shared/schema/index.js";
import { eq, like } from "drizzle-orm";
import { missionService } from "../server/domain/mission/core/mission.service";

async function launchTestMissions() {
    console.log("🚀 Launching Extensive Test Missions...");

    // 1. Get Org
    let [org] = await db.select().from(orgs).where(eq(orgs.name, "Acme")).limit(1);
    if (!org) {
        [org] = await db.select().from(orgs).limit(1);
    }
    if (!org) {
        console.error("❌ No organization found.");
        process.exit(1);
    }

    // 2. Find the Missions
    const testMissions = await db.select()
        .from(missions)
        .where(like(missions.name, "Mission: %Flow%")) // Adjusting to match seeded names
        .limit(10);
    
    const healthAudit = await db.select()
        .from(missions)
        .where(like(missions.name, "Mission: %Health Audit%"))
        .limit(1);

    const allMissions = [...testMissions, ...healthAudit];

    if (allMissions.length === 0) {
        console.error("❌ No test missions found in database.");
        process.exit(1);
    }

    console.log(`📡 Found ${allMissions.length} missions to launch.`);

    for (const mission of allMissions) {
        console.log(`▶️ Launching Mission [${mission.id}]: ${mission.name}...`);
        try {
            const result = await missionService.launchMission(
                mission.id,
                "system",
                org.id
            );
            if (result.success) {
                console.log(`✅ Launched! Run ID: ${result.missionRunId}`);
            } else {
                console.error(`❌ Launch Failed: ${result.error}`);
            }
        } catch (err: any) {
            console.error(`💥 Critical Launch Error: ${err.message}`);
        }
    }

    console.log("🏁 All launch requests processed.");
    process.exit(0);
}

launchTestMissions().catch(err => {
    console.error("❌ Script Failed:", err);
    process.exit(1);
});
