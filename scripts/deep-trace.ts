
import "dotenv/config";
import { db } from "../server/db/index.js";
import { agentChatMessages, agentRunSteps } from "../shared/schema/index.js";
import { desc } from "drizzle-orm";

async function run() {
    console.log("Checking latest chat message...");
    const [lastMsg] = await db.select().from(agentChatMessages).orderBy(desc(agentChatMessages.createdAt)).limit(1);

    if (lastMsg) {
        console.log(`Msg ID: ${lastMsg.id}`);
        console.log(`Content: ${lastMsg.content}`);

        console.log("\nChecking steps for this activity (if linked)...");
        // Steps are linked via runId or missionary, but chat messages don't always have runId.
        // Let's just look at the last 10 steps.
        const steps = await db.select().from(agentRunSteps).orderBy(desc(agentRunSteps.createdAt)).limit(10);
        steps.forEach(s => {
            console.log(`Step ID: ${s.id}, RunID: ${s.runId}, Type: ${s.type}, Tool: ${s.toolName}`);
            if (s.toolArgs) console.log(`  Args: ${JSON.stringify(s.toolArgs)}`);
            if (s.type === 'observation') console.log(`  Obs: ${s.content.substring(0, 200)}...`);
        });
    }

    process.exit(0);
}

run();
