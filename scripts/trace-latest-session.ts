
import "dotenv/config";
import { db } from "../server/db/index.js";
import { agentRunSteps, agentChatMessages } from "../shared/schema/index.js";
import { desc } from "drizzle-orm";

async function run() {
    console.log("Checking latest agent run steps for tool calls...");
    const steps = await db.select()
        .from(agentRunSteps)
        .orderBy(desc(agentRunSteps.createdAt))
        .limit(20);

    steps.forEach(s => {
        console.log(`- ID: ${s.id}, Type: ${s.type}, Tool: ${s.toolName}, Content: ${s.content.substring(0, 100)}...`);
        if (s.toolArgs) {
            console.log(`  Args: ${JSON.stringify(s.toolArgs)}`);
        }
    });

    console.log("\nChecking latest chat messages metadata...");
    const msgs = await db.select()
        .from(agentChatMessages)
        .orderBy(desc(agentChatMessages.createdAt))
        .limit(5);

    msgs.forEach(m => {
        console.log(`- Msg ID: ${m.id}, Role: ${m.role}, Content: ${m.content.substring(0, 50)}...`);
        console.log(`  Metadata: ${JSON.stringify(m.metadata)}`);
    });

    process.exit(0);
}

run();
