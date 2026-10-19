import { db } from "../server/database_service.ts";
import { crewSessions, crewTurns } from "../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

const sessionKey = "crew-1787026302372-2w0i5hd";

async function main() {
  console.log(`Debugging CREW room: ${sessionKey}`);
  
  const [session] = await db
    .select()
    .from(crewSessions)
    .where(eq(crewSessions.sessionKey, sessionKey))
    .limit(1);

  if (!session) {
    console.log("SESSION NOT FOUND");
    return;
  }

  console.log("Session found:", {
    id: session.id,
    organizationId: session.organizationId,
    projectId: session.projectId,
    mode: session.mode,
    members: session.members,
    createdAt: session.createdAt
  });

  const turns = await db
    .select()
    .from(crewTurns)
    .where(eq(crewTurns.sessionId, session.id))
    .orderBy(desc(crewTurns.createdAt))
    .limit(10);

  console.log(`\nRecent turns (${turns.length}):`);
  for (const turn of turns) {
    console.log(`- ${turn.speakerName} (${turn.speakerType}): ${turn.content.substring(0, 150)}...`);
    console.log(`  Tools used: ${turn.toolsUsed?.map(t => t.name).join(", ") || "none"}`);
    console.log(`  Artifacts: ${turn.artifacts?.length || 0}`);
    if (turn.artifacts?.length > 0) {
      console.log(`  Artifact details:`, JSON.stringify(turn.artifacts, null, 2));
    }
    console.log(`  Created: ${turn.createdAt}`);
  }
}

main().catch(console.error);