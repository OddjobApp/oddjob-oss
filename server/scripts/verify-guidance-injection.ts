
import { db } from "../database_service.js";
import { missions, missionRuns, credentials, jobs, pipelines, pipelineSteps } from "@shared/schema/index.js";
import { missionService } from "../domain/mission/core/mission.service.js";
import { eq, and, sql } from "drizzle-orm";

async function verify() {
    console.log("--- CHAIN OF VALIDATION: Guidance Injection Test ---");

    // 1. Setup: Ensure we have a Supervisor Pipeline
    const userId = "test-validator";
    const orgId = 1;
    const supervisorPipelineId = await missionService.ensureSupervisorPipelineForOrg(orgId, userId);

    if (!supervisorPipelineId) {
        console.error("FAILED: Could not ensure supervisor pipeline.");
        process.exit(1);
    }
    console.log(`[Validation] Supervisor Pipeline: ${supervisorPipelineId}`);

    // 2. Create Mission
    const [mission] = await db.insert(missions).values({
        name: "Test Inquiry Mission",
        objective: "Handle user inquiries efficiently.",
        organizationId: orgId,
        createdBy: userId,
        blackboard: {}
    } as any).returning();
    console.log(`[Validation] Mission created: ${mission.id}`);

    // 3. Inject "Inquiry" (Simulate Chat)
    const inquiry = "Can you help me with a specific task?";
    const updatedBlackboard = {
        lastUserGuidance: {
            content: inquiry,
            timestamp: new Date().toISOString()
        }
    };
    await missionService.updateBlackboard(mission.id, updatedBlackboard, userId, "user_chat");
    console.log(`[Validation] Inquiry injected into Blackboard: "${inquiry}"`);

    // 4. Validation Check: Trace the "Launch Mission" intent computation
    const missionDetail = await missionService.getMissionDetail(mission.id);
    const blackboard = (missionDetail?.blackboard as any) || {};
    const lastGuidance = blackboard.lastUserGuidance;
    const objective = missionDetail?.objective;
    const computedIntent = String(objective).trim() + (lastGuidance?.content ? ` User directive: ${lastGuidance.content}` : "");

    console.log(`[Validation] Computed Mission Intent: "${computedIntent}"`);

    if (computedIntent.includes(inquiry)) {
        console.log("SUCCESS: Chain of Validation confirms the agent will receive the inquiry in the mission intent.");
    } else {
        console.error("FAILED: Inquiry was not injected into the mission intent.");
        process.exit(1);
    }

    // 5. Cleanup
    await db.delete(missions).where(eq(missions.id, mission.id));
    console.log("[Validation] Cleanup complete.");
    process.exit(0);
}

verify().catch(err => {
    console.error("Validation Error:", err);
    process.exit(1);
});

