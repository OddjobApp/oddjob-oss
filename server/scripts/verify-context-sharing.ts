
import "dotenv/config";
import { db } from "../database_service.js";
import { missions } from "@shared/schema/index.js";
import { agentService } from "../domain/agents/agent.service.js";
import { eq } from "drizzle-orm";

async function verify() {
    console.log("=== Context Sharing (Blackboard) Verification ===");

    const TEST_ORG_ID = 1;
    const TEST_USER_ID = "test-user-context";

    try {
        // 1. Create a test mission with initial blackboard content
        const missionName = "Context Test Mission " + Date.now();
        console.log(`[Step 1] Creating mission '${missionName}'...`);

        const [mission] = await db.insert(missions).values({
            name: missionName,
            objective: "Verify blackboard context sharing",
            organizationId: TEST_ORG_ID,
            type: "mission_based",
            createdBy: TEST_USER_ID,
            blackboard: {
                initialNote: "SecretCode: ALPHA-TANGO-77",
                status: "active"
            }
        }).returning();

        console.log(`[Step 1] OK: Created mission ${mission.id}`);

        // 2. Simulate Agent Interaction (Read)
        // We'll ask the agent to reveal the secret code found in its context.
        // This confirms the blackboard content was injected into the system prompt.

        console.log(`[Step 2] Testing Context Injection (Agent Read)...`);

        const readResult = await agentService.chat({
            message: "What is the SecretCode stored in our shared blackboard? Return ONLY the code.",
            userContext: {
                organizationId: TEST_ORG_ID,
                userId: TEST_USER_ID,
                isAdmin: true,       // admin to ensure tool access
                isSuperAdmin: true,
                isOrgAdmin: true,
                permissions: ["saas:read", "saas:write"]
            },
            context: {
                jobId: 0, // Ad-hoc run
                missionId: mission.id,
                mode: 'execute'
            }
        });

        const readResponse = typeof readResult === 'string' ? readResult : readResult.response;
        console.log(`[Step 2] Agent Response: "${readResponse}"`);

        if (readResponse.includes("ALPHA-TANGO-77")) {
            console.log(`[Step 2] OK: Agent found the secret code!`);
        } else {
            console.error(`[Step 2] FAILED: Agent did not find the secret code.`);
            // Don't fail hard, let's try update test
        }

        // 3. Simulate Agent Interaction (Write)
        // ask agent to update the blackboard using the tool
        console.log(`[Step 3] Testing Context Update (Tool Usage)...`);

        const updateResult = await agentService.chat({
            message: "Update the blackboard. Set 'status' to 'verified' and add a new field 'verifiedBy' with value 'Agent007'. Use the update_blackboard tool.",
            userContext: {
                organizationId: TEST_ORG_ID,
                userId: TEST_USER_ID,
                isAdmin: true,
                isSuperAdmin: true,
                isOrgAdmin: true,
                permissions: ["saas:read", "saas:write"]
            },
            context: {
                jobId: 0,
                missionId: mission.id,
                mode: 'execute'
            }
        });
        const updateResponse = typeof updateResult === 'string' ? updateResult : updateResult.response;
        console.log(`[Step 3] Agent Response: "${updateResponse}"`);

        // 4. Verify Database state
        const [updatedMission] = await db.select().from(missions).where(eq(missions.id, mission.id));
        const bb = updatedMission.blackboard as any;

        console.log(`[Step 4] Checking DB:`, JSON.stringify(bb));

        if (bb.status === 'verified' && bb.verifiedBy === 'Agent007') {
            console.log(`[Step 4] OK: Blackboard updated successfully!`);
        } else {
            console.error(`[Step 4] FAILED: Database does not reflect changes.`);
        }

    } catch (e: any) {
        console.error("Verification failed:", e);
    } finally {
        console.log("Exiting.");
        process.exit();
    }
}

verify();

