import "dotenv/config";
import { db } from "../server/database_service.js";
import { crewSessions, crewTurns } from "../shared/schema/crew.js";
import { eq } from "drizzle-orm";

async function main() {
  const sessionKey = "crew-1786650952315-bk0eniq";
  const [session] = await db
    .select()
    .from(crewSessions)
    .where(eq(crewSessions.sessionKey, sessionKey));

  if (!session) return;

  const turns = await db
    .select()
    .from(crewTurns)
    .where(eq(crewTurns.sessionId, session.id))
    .orderBy(crewTurns.id);

  console.log(`=== FULL TRANSCRIPT FOR ${sessionKey} (${turns.length} turns) ===\n`);
  for (const t of turns) {
    console.log(`[Round ${t.round}] [${t.speakerType.toUpperCase()}] ${t.speakerName}:`);
    console.log(t.content);
    if (t.toolsUsed && Array.isArray(t.toolsUsed) && t.toolsUsed.length) {
      console.log("  >>> TOOLS:", JSON.stringify(t.toolsUsed));
    }
    if (t.artifacts && Array.isArray(t.artifacts) && t.artifacts.length) {
      console.log("  >>> ARTIFACTS:", JSON.stringify(t.artifacts));
    }
    console.log("\n------------------------------------------------------------\n");
  }
}

main().catch(console.error);
