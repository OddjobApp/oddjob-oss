import { db } from "../../server/database_service.js";
import { agentChatMessages, agentRunSteps } from "../../shared/schema/index.js";
import { desc, eq } from "drizzle-orm";

async function main() {
    console.log("--- LATEST CHAT MESSAGES ---");
    const msgs = await db.select()
        .from(agentChatMessages)
        .orderBy(desc(agentChatMessages.id))
        .limit(10);
    console.log(JSON.stringify(msgs.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content ? m.content.slice(0, 150) : null,
        sessionId: m.sessionId,
        createdAt: m.createdAt
    })), null, 2));

    console.log("\n--- LATEST RUN STEPS ---");
    const steps = await db.select()
        .from(agentRunSteps)
        .orderBy(desc(agentRunSteps.id))
        .limit(20);
    console.log(JSON.stringify(steps.map(s => ({
        id: s.id,
        runId: s.runId,
        type: s.type,
        content: s.content ? s.content.slice(0, 150) : null,
        createdAt: s.createdAt
    })), null, 2));
}

main().catch(console.error).finally(() => process.exit(0));
