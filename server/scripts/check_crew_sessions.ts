import { db } from "@server/database_service.js";
import { crewSessions, crewTurns, crewMembers, supervisorNotes } from "@shared/schema/index.js";
import { eq, or } from "drizzle-orm";

async function main() {
  const sessions = await db
    .select()
    .from(crewSessions)
    .where(
      or(
        eq(crewSessions.sessionKey, "crew-1786495732455-tacq1qy"),
        eq(crewSessions.sessionKey, "crew-1786553830191-apkzu0n")
      )
    );

  console.log("=== SESSIONS ===");
  console.log(JSON.stringify(sessions.map(s => ({
    id: s.id,
    key: s.sessionKey,
    activeTopic: s.activeTopic,
    nextSteps: s.nextSteps,
    consensusLevel: s.consensusLevel,
    updatedAt: s.updatedAt,
  })), null, 2));

  for (const s of sessions) {
    const turns = await db.select().from(crewTurns).where(eq(crewTurns.sessionId, s.id));
    const members = await db.select().from(crewMembers).where(eq(crewMembers.sessionId, s.id));
    const notes = await db.select().from(supervisorNotes).where(eq(supervisorNotes.sessionId, s.id));

    console.log(`\n=== SESSION ${s.sessionKey} (id: ${s.id}) ===`);
    console.log(`Turns count: ${turns.length}, Members count: ${members.length}, Supervisor Notes: ${notes.length}`);
    console.log("Turns:");
    for (const t of turns) {
      console.log(`  [${t.id}] ${t.speakerName} (${t.speakerType}): "${t.content.substring(0, 120)}"`);
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
