
import "dotenv/config";
import { db } from "../../server/database_service.js";
import { agentChatMessages, agentRunSteps } from "../../shared/schema/index.js";
import { desc } from "drizzle-orm";

async function run() {
    console.log("Fetching last agent chat message...");
    try {
        const [message] = await db.select().from(agentChatMessages).orderBy(desc(agentChatMessages.createdAt)).limit(1);

        console.log("\n--- LAST MESSAGE ---");
        if (message) {
            console.log(`[${message.createdAt.toISOString()}] ${message.role.toUpperCase()}: ${message.content}`);
        }
    } catch (e: any) {
        console.error("Error fetching message:", e.message);
    }

    console.log("\nFetching last agent run steps...");
    try {
        const steps = await db.select().from(agentRunSteps).orderBy(desc(agentRunSteps.createdAt)).limit(10);

        console.log("\n--- RECENT STEPS ---");
        steps.forEach(step => {
            console.log(`[${step.createdAt?.toISOString()}] ID: ${step.id} | Type: ${step.type} | Tool: ${step.toolName} | Run: ${step.runId}`);
            if (step.toolName) {
                console.log(`  Args: ${JSON.stringify(step.toolArgs)}`);
            }
            console.log(`  Content: ${step.content.substring(0, 150)}...`);
        });
    } catch (e: any) {
        console.error("Error fetching steps:", e.message);
    }

    process.exit(0);
}

run().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
});
