
import { db } from "../database_service.js";
import { missions, missionMembers } from "@shared/schema/index.js";
import { missionService } from "../domain/mission/core/mission.service.js";
import { promptService } from "../domain/ai/core/prompt-service.js";
import { verifyUtils } from "./verify-utils.js";
import { eq } from "drizzle-orm";

async function run() {
    console.log("Starting Mission Prompt Verification...");

    // 1. Create a Test Mission
    const missionName = `Test Logic Mission ${Date.now()}`;
    const [mission] = await db.insert(missions).values({
        name: missionName,
        objective: "Verify prompt injection logic.",
        type: "manual",
        createdBy: "tester",
        blackboard: {}
    } as any).returning();
    verifyUtils.logResult("Create Mission", true, `ID: ${mission.id}`);

    // 2. Add a member (Job)
    const jobId = 99999 + Math.floor(Math.random() * 10000); // Fake Job ID
    await db.insert(missionMembers).values({
        missionId: mission.id,
        entityType: "job",
        entityId: jobId,
        role: "member"
    });
    console.log(`Added Job ${jobId} to Mission ${mission.id}`);

    // 3. Test Resolution
    const resolvedMission = await missionService.getMissionForEntity({ entityType: 'job', entityId: jobId });

    if (!resolvedMission || resolvedMission.id !== mission.id) {
        verifyUtils.logResult("Mission Resolution", false, "Could not resolve mission from job ID.");
        process.exit(1);
    }
    verifyUtils.logResult("Mission Resolution", true);

    // 4. Test Prompt Injection
    // Mock Context with missionId
    const clientContext = {
        missionId: mission.id,
        mode: "execute"
    };

    const userContext = {
        userId: "tester",
        organizationId: 1,
        isAdmin: true
    };

    const result = await promptService.buildSystemPrompt(
        clientContext,
        userContext,
        [], // allowedTools
        "openai" // provider
    );

    // Check for Mission Context
    if (result.prompt.includes(`MISSION CONTEXT: ${missionName}`) && result.prompt.includes("Verify prompt injection logic.")) {
        verifyUtils.logResult("Prompt Injection", true, "Prompt contains Mission Context.");
    } else {
        verifyUtils.logResult("Prompt Injection", false, "Prompt does NOT contain Mission Context.");
        process.exit(1);
    }

    // Cleanup
    await db.delete(missionMembers).where(eq(missionMembers.missionId, mission.id));
    await db.delete(missions).where(eq(missions.id, mission.id));
    verifyUtils.logResult("Cleanup", true);
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});

