import { db } from "../database_service.js";
import { crewSessions, crewTurns, crewMembers, supervisorNotes } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function debugSession() {
  const sessionKey = "crew-1786562509495-d2t482v";
  const [session] = await db.select().from(crewSessions).where(eq(crewSessions.sessionKey, sessionKey)).limit(1);

  if (!session) {
    console.log(`Session ${sessionKey} not found in DB.`);
    process.exit(0);
  }

  console.log("=== SESSION METADATA ===");
  console.log(JSON.stringify({
    id: session.id,
    sessionKey: session.sessionKey,
    title: session.title,
    activeTopic: session.activeTopic,
    nextSteps: session.nextSteps,
    consensusLevel: session.consensusLevel,
    updatedAt: session.updatedAt,
  }, null, 2));

  const members = await db.select().from(crewMembers).where(eq(crewMembers.sessionId, session.id));
  console.log(`\n=== MEMBERS (${members.length}) ===`);
  console.log(JSON.stringify(members.map(m => ({ id: m.id, cardId: m.agentCardId, joinedAt: m.joinedAt })), null, 2));

  const notes = await db.select().from(supervisorNotes).where(eq(supervisorNotes.sessionId, session.id));
  console.log(`\n=== SUPERVISOR NOTES (${notes.length}) ===`);
  console.log(JSON.stringify(notes, null, 2));

  const turns = await db.select().from(crewTurns).where(eq(crewTurns.sessionId, session.id));
  console.log(`\n=== TURNS (${turns.length}) ===`);
  for (const t of turns) {
    console.log(`  [Turn ${t.id} | Round ${t.round}] ${t.speakerName} (${t.speakerType}): "${t.content.substring(0, 150)}"`);
  }

  process.exit(0);
}

debugSession().catch(err => {
  console.error("Debug Session Error:", err);
  process.exit(1);
});
