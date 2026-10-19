import { db } from "../server/db/index.js";
import { agentChatMessages } from "@shared/schema/index.js";
import { desc } from "drizzle-orm";

async function run() {
    const msgs = await db.select().from(agentChatMessages).orderBy(desc(agentChatMessages.id)).limit(10);
    console.log(JSON.stringify(msgs, null, 2));
    process.exit(0);
}
run();
