import "dotenv/config";
import { db } from "../server/db/index.js";
import { missionRuns, missions, orgs } from "@shared/schema/index.js";
import { eq, like } from "drizzle-orm";

async function triggerExtensiveMissions() {
    console.log("🚀 Triggering Extensive Mission Runs...");

    // 1. Get Org (Acme)
    let [org] = await db.select().from(orgs).where(eq(orgs.name, "Acme")).limit(1);
    if (!org) {
        [org] = await db.select().from(orgs).limit(1);
    }

    // 2. Find seeded missions
    const seededMissions = await db.select().from(missions).where(like(missions.name, "Mission: %"));

    if (seededMissions.length === 0) {
        console.error("❌ No seeded missions found. Run the seed script first.");
        process.exit(1);
    }

    for (const mission of seededMissions) {
        console.log(`✨ Triggering run for: ${mission.name} (ID: ${mission.id})`);
        
        const [run] = await db.insert(missionRuns).values({
            missionId: mission.id,
            organizationId: org.id!,
            name: `${mission.name} - Automated Test`,
            status: "active",
            missionContext: { "trigger": "Extensive Test Suite" },
            createdBy: "system"
        }).returning();

        console.log(`✅ Mission Run Started: ID ${run.id}`);
    }

    console.log("🏁 All test missions triggered!");
    process.exit(0);
}

triggerExtensiveMissions().catch(err => {
    console.error("❌ Trigger Failed:", err);
    process.exit(1);
});
