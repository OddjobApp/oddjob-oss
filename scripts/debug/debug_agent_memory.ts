
import "dotenv/config";
import { db } from "../../server/database_service.js";
import { agentRunSteps, agentChatMessages } from "../../shared/schema/index.js";
import { desc, sql } from "drizzle-orm";

async function checkMemory() {
    try {
        console.log("--- Checking Agent Memory (agentRunSteps) ---");
        const steps = await db.select({
            id: agentRunSteps.id,
            runId: agentRunSteps.runId,
            jobId: agentRunSteps.jobId,
            createdAt: agentRunSteps.createdAt,
            toolName: agentRunSteps.toolName,
            type: agentRunSteps.type
        })
            .from(agentRunSteps)
            .orderBy(desc(agentRunSteps.createdAt))
            .limit(20);

        console.log("Recent Run Steps:");
        console.table(steps);

        console.log("\n--- Checking Recent Chat Messages (agentChatMessages) ---");
        const messages = await db.select({
            id: agentChatMessages.id,
            jobId: agentChatMessages.jobId,
            role: agentChatMessages.role,
            createdAt: agentChatMessages.createdAt
        })
            .from(agentChatMessages)
            .orderBy(desc(agentChatMessages.createdAt))
            .limit(20);

        console.log("Recent Messages:");
        console.table(messages);

        const [counts] = await db.select({
            stepCount: sql<number>`count(*)::int`
        }).from(agentRunSteps);

        const [msgCounts] = await db.select({
            msgCount: sql<number>`count(*)::int`
        }).from(agentChatMessages);

        console.log(`\nTotal Run Steps: ${counts.stepCount}`);
        console.log(`Total Chat Messages: ${msgCounts.msgCount}`);

    } catch (error) {
        console.error("Debug script failed:", error);
    } finally {
        process.exit(0);
    }
}

checkMemory();
