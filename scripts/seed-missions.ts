import "dotenv/config";
import { db } from "../server/db/index.js";
import { missions, missionMembers, missionRuns, orgs, pipelines, jobs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function seedMissions() {
    console.log("🚀 Seeding Missions...");

    // 1. Get or Create Org
    let [org] = await db.select().from(orgs).where(eq(orgs.name, "Acme")).limit(1);
    if (!org) {
        let [defaultOrg] = await db.select().from(orgs).where(eq(orgs.name, "Acme Corp (Default)")).limit(1);
        org = defaultOrg;
    }

    if (!org) {
        console.error("❌ No organization found. Please run npm run db:seed first (or fix it).");
        process.exit(1);
    }

    console.log(`✅ Using Org: ${org.name} (ID: ${org.id})`);

    // 2. Create a Mission
    console.log("✨ Creating Mission ID 1...");
    const [mission] = await db.insert(missions).values({
        id: 1, // Force ID 1 if possible, or omit if serial takes over
        name: "Initial System Mission",
        description: "Primary mission for system verification and monitoring.",
        type: "supervisor_led",
        organizationId: org.id,
        objective: "Maintain system stability and monitor agent performance.",
        createdBy: "system",
        status: "active",
        blackboard: { "initialized": true, "phase": "alpha" }
    } as any).onConflictDoNothing().returning();

    const finalMission = mission || (await db.select().from(missions).where(eq(missions.id, 1)).limit(1))[0];

    if (finalMission) {
        console.log(`✅ Mission Created/Ensured (ID: ${finalMission.id})`);

        // 3. Create a Mission Run
        console.log("✨ Creating Mission Run for Mission 1...");
        const [run] = await db.insert(missionRuns).values({
            missionId: finalMission.id,
            organizationId: org.id,
            name: "Initial Run 001",
            status: "active",
            missionContext: { "start_reason": "Manual seed" },
            createdBy: "system"
        }).returning();

        console.log(`✅ Mission Run Created (ID: ${run.id})`);
    } else {
        console.error("❌ Failed to create or find Mission ID 1");
    }

    console.log("🏁 Mission Seeding Completed!");
    process.exit(0);
}

seedMissions().catch(err => {
    console.error("❌ Seeding Failed:", err);
    process.exit(1);
});
