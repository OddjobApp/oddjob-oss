import { db } from "../../server/database_service.js";
import { agentChatMessages } from "../../shared/schema/index.js";
import { desc } from "drizzle-orm";

async function main() {
    try {
        const messages = await db.select()
            .from(agentChatMessages)
            .orderBy(desc(agentChatMessages.createdAt))
            .limit(10);

        for (const msg of messages) {
            console.log(`\n--- [${msg.createdAt.toISOString()}] Role: ${msg.role} | SessionId: ${msg.sessionId} ---`);
            console.log(`Content: ${msg.content}`);
        }
    } catch (e) {
        console.error("Error:", e);
    }
}

main().then(() => process.exit(0));
