import { db } from "../database_service.js";
import { agentChatMessages, agentRunSteps } from "../../shared/schema/index.js";
import { desc, eq } from "drizzle-orm";

async function main() {
    // 1. Get the latest session ID
    const latestMsgs = await db.select()
        .from(agentChatMessages)
        .orderBy(desc(agentChatMessages.id))
        .limit(1);

    if (latestMsgs.length === 0) {
        console.log("No agent chat messages found.");
        process.exit(0);
    }

    const sessionId = latestMsgs[0].sessionId;
    if (!sessionId) {
        console.log("Latest message has no session ID.");
        process.exit(0);
    }
    console.log(`Analyzing messages for Session ID: ${sessionId}`);

    // 2. Fetch all messages in the session
    const messages = await db.select()
        .from(agentChatMessages)
        .where(eq(agentChatMessages.sessionId, sessionId))
        .orderBy(agentChatMessages.id);

    console.log(`\n--- Messages (${messages.length}) ---`);
    for (const msg of messages) {
        console.log(`[${msg.role.toUpperCase()}] at ${msg.createdAt}`);
        console.log(`Content: ${msg.content}`);
        console.log(`Metadata: ${JSON.stringify(msg.metadata)}`);
        console.log("-----------------------------------");
    }

    // 3. Fetch steps
    const steps = await db.select()
        .from(agentRunSteps)
        .orderBy(desc(agentRunSteps.id))
        .limit(15);
    console.log(`\n--- Recent Run Steps (${steps.length}) ---`);
    for (const step of steps) {
        console.log(`Step ID: ${step.id}, Run ID: ${step.runId}, Type: ${step.type}`);
        console.log(`Content: ${step.content.slice(0, 200)}`);
        console.log("-----------------------------------");
    }

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
