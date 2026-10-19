
import { db } from "../server/db/index.js";
import { agentChatMessages } from "../shared/schema/index";
import { desc, eq } from "drizzle-orm";

async function main() {
    console.log("Fetching last 5 agent-9 chat messages...");
    const messages = await db.select()
        .from(agentChatMessages)
        .orderBy(desc(agentChatMessages.createdAt))
        .limit(10);

    messages.forEach(m => {
        console.log(`\n[${m.role.toUpperCase()}] at ${m.createdAt}`);
        console.log(m.content);
    });
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
