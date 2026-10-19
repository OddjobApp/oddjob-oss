import { db } from "../database_service.js";
import { crewSessions, crewTurns } from "../../shared/schema/crew.js";
import { eq } from "drizzle-orm";

async function run() {
    const key = "crew-1786637686160-bmfbipt";
    console.log("=== Inspecting Conversation:", key, "===");
    const [session] = await db.select().from(crewSessions).where(eq(crewSessions.sessionKey, key));
    if (!session) {
        console.log("Session not found");
        return;
    }

    const turns = await db.select().from(crewTurns).where(eq(crewTurns.sessionId, session.id));
    console.log(`Total turns: ${turns.length}\n`);

    turns.forEach((t, i) => {
        console.log(`[Turn ${i + 1}] ID:${t.id} | Speaker: ${t.speakerType} | Speaker: ${t.speakerName || 'none'}`);
        console.log(`Text: ${t.content.slice(0, 300)}${t.content.length > 300 ? '...' : ''}\n`);
    });
}

run().then(() => process.exit(0)).catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
