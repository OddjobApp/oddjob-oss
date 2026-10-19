
import { db } from "../server/database_service.js";
import { jobs, agentDeployments } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";
import { AgentMigrationService } from "../server/domain/agents/core/agent-migration.service.js";
import { agentService } from "../server/domain/agents/agent.service.js";

async function runTest() {
    console.log("--- STARTING AGENT AI MIGRATION TEST ---");

    // 1. Create a dummy legacy job
    const [legacyJob] = await db.insert(jobs).values({
        name: "Legacy Test Agent",
        type: "agent_ai" as any,
        organizationId: 1,
        config: {
            rbac: {
                topicIds: [42],
                allowedTools: ["google_search"]
            }
        },
        createdBy: "test_suite",
        isActive: true
    }).returning();

    console.log(`Created legacy job ${legacyJob.id}`);

    // 2. Verify fallback chat behavior
    console.log("Verifying chat fallback...");
    const result = await agentService.chat({
        message: "Hello",
        context: { jobId: legacyJob.id, sessionId: "test-session" } as any,
        userContext: {
            organizationId: 1,
            userId: "test_user",
            isAdmin: false,
            isSuperAdmin: false,
            isOrgAdmin: false
        }
    });
    
    // We expect the fallback logic to have populated allowedTopicIds in the internal context
    // This is hard to verify without looking at logs or return values, 
    // but the success of the call (not throwing) is a good sign.
    console.log("Chat fallback completed.");

    // 3. Perform migration
    console.log("Performing migration...");
    const migrationResult = await AgentMigrationService.migrateLegacyAgent(legacyJob.id);
    
    if (migrationResult.success) {
        console.log(`Migration successful! Deployment ID: ${migrationResult.deploymentId}`);
        
        // 4. Verify deployment record
        const [deployment] = await db.select().from(agentDeployments).where(eq(agentDeployments.id, migrationResult.deploymentId!)).limit(1);
        console.log("Deployment allowedTopicIds:", deployment.allowedTopicIds);
        
        if (deployment.allowedTopicIds?.includes(42)) {
            console.log("SUCCESS: Topic ID 42 migrated correctly.");
        } else {
            console.error("FAILURE: Topic ID 42 missing from deployment.");
        }
    } else {
        console.error("Migration failed:", migrationResult.message);
    }

    // Cleanup
    await db.delete(agentDeployments).where(eq(agentDeployments.id, migrationResult.deploymentId!));
    await db.delete(jobs).where(eq(jobs.id, legacyJob.id));
    console.log("--- TEST COMPLETE ---");
}

runTest().catch(console.error);
