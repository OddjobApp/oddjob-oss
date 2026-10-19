
import { db } from "../server/db/index.js";
import { agentChatMessages } from "@shared/schema/index.js";
import { like } from "drizzle-orm";

async function checkChat() {
    const messages = await db.select().from(agentChatMessages).where(like(agentChatMessages.sessionId, 'test-session-%')).orderBy(agentChatMessages.createdAt);
    console.log(`Found ${messages.length} messages:`);
    messages.forEach(m => {
        console.log(`[${m.role.toUpperCase()}] ${m.content}`);
        if (m.metadata && (m.metadata as any).toolCalls) {
            console.log("  Tools Called:", JSON.stringify((m.metadata as any).toolCalls));
        }
    });
    process.exit(0);
}

checkChat().catch(err => {
    console.error(err);
    process.exit(1);
});
