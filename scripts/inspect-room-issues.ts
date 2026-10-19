import "dotenv/config";
import { db } from "../server/database_service.js";
import { crewSessions, crewTurns, supervisorNotes, crewIssues } from "../shared/schema/crew.js";
import { eq } from "drizzle-orm";

async function main() {
  const sessionKey = "crew-1786650952315-bk0eniq";
  console.log(`Querying sessionKey: ${sessionKey}`);

  const [session] = await db
    .select()
    .from(crewSessions)
    .where(eq(crewSessions.sessionKey, sessionKey));

  if (!session) {
    console.log("No session found with that key. Listing recent sessions:");
    const recents = await db.select().from(crewSessions).limit(5);
    console.log(recents);
    return;
  }

  console.log("=== SESSION ===");
  console.log(session);

  const turns = await db
    .select()
    .from(crewTurns)
    .where(eq(crewTurns.sessionId, session.id));

  console.log(`=== TURNS (${turns.length}) ===`);
  for (const t of turns) {
    console.log(`[Turn ${t.id} - Round ${t.round}] ${t.speakerName} (${t.speakerType}):`);
    console.log(t.content);
    if (t.toolsUsed && Array.isArray(t.toolsUsed) && t.toolsUsed.length) {
      console.log("  Tools Used:", t.toolsUsed);
    }
    if (t.artifacts && Array.isArray(t.artifacts) && t.artifacts.length) {
      console.log("  Artifacts:", t.artifacts);
    }
    console.log("---");
  }

  const notes = await db
    .select()
    .from(supervisorNotes)
    .where(eq(supervisorNotes.sessionId, session.id));

  console.log(`=== SUPERVISOR NOTES (${notes.length}) ===`);
  for (const n of notes) {
    console.log(`[${n.noteType.toUpperCase()} - Round ${n.round}] ${n.content}`);
  }

  const issues = await db
    .select()
    .from(crewIssues)
    .where(eq(crewIssues.sessionId, session.id));

  console.log(`=== CREW ISSUES (${issues.length}) ===`);
  for (const iss of issues) {
    console.log(`[Issue ${iss.id} - ${iss.severity.toUpperCase()} - ${iss.status}] ${iss.title}`);
    console.log(`Detail: ${iss.detail}`);
    console.log(`Consensus Level: ${iss.consensusLevel}`);
    console.log("---");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
