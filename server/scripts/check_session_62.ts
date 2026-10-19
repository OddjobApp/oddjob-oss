import { db } from "../database_service.js";
import { crewSessions, crewTurns, crewMembers, supervisorNotes, crewPlans, crewIssues } from "../../shared/schema/crew.js";
import { eq } from "drizzle-orm";

async function main() {
  const s62 = await db.select().from(crewSessions).where(eq(crewSessions.id, 62));
  console.log("=== SESSION 62 ===", JSON.stringify(s62, null, 2));

  const turns62 = await db.select().from(crewTurns).where(eq(crewTurns.sessionId, 62));
  console.log(`=== SESSION 62 TURNS (${turns62.length}) ===`);
  for (const t of turns62) {
    console.log(`\nTurn id=${t.id}, round=${t.round}, speaker=${t.speakerName} (${t.speakerType}):`);
    console.log(`Content:\n${t.content}`);
    console.log(`toolsUsed:`, JSON.stringify(t.toolsUsed, null, 2));
    console.log(`artifacts:`, JSON.stringify(t.artifacts, null, 2));
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
