import "dotenv/config";
import { runAgentLoop } from "../domain/agents/agent-runner.js";
import { db } from "../database_service.js";
import { users, orgs, missions } from "../../shared/schema/index.js";
import { MissionLifecycleService } from "../domain/mission/core/mission-lifecycle.service.js";
import { GoogleClient } from "../domain/ai/core/providers/google-client.js";
import { eq } from "drizzle-orm";

async function main() {
    console.log("Starting Hierarchical Delegation Test...");

    const [user] = await db.select().from(users).limit(1);
    if (!user) {
        console.error("No user found. Run DB seed first.");
        process.exit(1);
    }
    const [org] = await db.select().from(orgs).limit(1);
    if (!org) {
        console.error("No org found. Run DB seed first.");
        process.exit(1);
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("GEMINI_API_KEY not found in environment");
        process.exit(1);
    }

    const sessionId = `test-delegation-${Date.now()}`;
    const initialContext = {
        userId: user.id,
        username: user.username,
        organizationId: org.id,
        orgSlug: org.name.toLowerCase().replace(/\s+/g, '-'),
        sessionId
    };

    // 1. Create the Parent Mission
    console.log("Creating Parent Mission...");
    const goal = "You are a master orchestrator. Your goal is to find out the current population of Paris. You MUST NOT search the web yourself. You MUST delegate this task to a sub-mission using the spawn_sub_mission tool. Once the sub-mission completes, read the result from the blackboard and report it.";
    
    const [parentMission] = await db.insert(missions).values({
        name: "Test Hierarchical Mission",
        objective: goal,
        organizationId: org.id,
        type: "ai_agent",
        executionStrategy: "dynamic_autonomous",
        createdBy: user.username,
        blackboard: {},
    }).returning();

    console.log(`Parent Mission created. ID: ${parentMission.id}`);

    // Create a MissionRun for the parent
    const { missionRuns } = await import("../../shared/schema/missions/index.js");
    const [parentRun] = await db.insert(missionRuns).values({
        missionId: parentMission.id,
        organizationId: org.id,
        name: parentMission.name,
        pipelineSequence: [],
        createdBy: user.username,
        missionContext: {}
    }).returning();
    console.log(`Parent MissionRun created. ID: ${parentRun.id}`);

    const extendedContext = { ...initialContext, missionId: parentMission.id, jobId: parentRun.id };

    // 2. Launch the Parent Mission Agent
    const client = new GoogleClient();
    console.log("Starting Parent Mission agent loop...");

    // We only provide the spawn_sub_mission tool to force delegation
    const allowedTools = ["spawn_sub_mission", "blackboard_read"];
    
    // Pass missionId in context so the tool knows which mission to attach to
    const traceContext = { missionId: parentMission.id };

    try {
        const result = await runAgentLoop(
            client,
            {
                model: "gemini-2.0-flash-001",
                isPriority: false,
                temperature: 0.2,
                userPrompt: "",
                useCache: false,
                saveOutputToFile: false
            },
            goal,
            allowedTools,
            10, // maxIterations
            apiKey,
            extendedContext,
            traceContext as any,
            false,
            undefined,
            "none" // no supervision to run autonomously
        );
        console.log("Parent Agent finished execution.");
    } catch (err) {
        console.error("Parent Agent execution failed:", err);
    }

    // 3. Verify Blackboard and Sub-Missions
    console.log("Verifying Hierarchy and Blackboard State...");
    
    // Fetch parent mission again to see the blackboard
    const [updatedParent] = await db.select().from(missions).where(eq(missions.id, parentMission.id));
    
    const blackboard = updatedParent.blackboard as Record<string, any> || {};
    console.log("Parent Blackboard State:", JSON.stringify(blackboard, null, 2));

    const subMissions = blackboard.active_sub_missions || [];
    
    if (subMissions.length === 0) {
        console.error("Test Failed: No sub-missions found in parent blackboard.");
        process.exit(1);
    }

    console.log(`Found ${subMissions.length} sub-mission(s).`);
    
    // Check if the sub-mission is recorded properly
    const firstSubMissionId = subMissions[0].missionId || subMissions[0].subMissionId || subMissions[0];
    console.log(`Verifying Sub-Mission ID: ${firstSubMissionId}`);
    
    const [subMissionRecord] = await db.select().from(missions).where(eq(missions.id, parseInt(firstSubMissionId.toString(), 10)));
    
    if (!subMissionRecord) {
        console.error("Test Failed: Sub-mission record does not exist in DB.");
        process.exit(1);
    }

    console.log(`Sub-Mission found in DB. Parent ID: ${subMissionRecord.parentId}, Status: ${subMissionRecord.status}`);
    
    if (subMissionRecord.parentId !== parentMission.id) {
        console.error(`Test Failed: Sub-mission parentId (${subMissionRecord.parentId}) does not match Parent ID (${parentMission.id})`);
        process.exit(1);
    }

    console.log("Test Passed! Hierarchical Delegation is fully functional.");
    process.exit(0);
}

main().catch(err => {
    console.error("Unhandled error:", err);
    process.exit(1);
});
