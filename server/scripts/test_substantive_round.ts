import { db } from "../database_service.js";
import { crewOrchestratorService } from "../domain/crew/core/crew-orchestrator.service.js";
import { crewSessions, crewTurns, supervisorNotes } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function testSubstantiveRound() {
  const sessionKey = "crew-1786562509495-d2t482v";
  const [session] = await db.select().from(crewSessions).where(eq(crewSessions.sessionKey, sessionKey)).limit(1);

  if (!session) {
    console.error("Session not found");
    process.exit(1);
  }

  console.log(`\nTesting substantive discussion round for session ${sessionKey}...`);
  const result = await crewOrchestratorService.runRound({
    orgId: session.organizationId,
    sessionKey,
    message: "What can we mature in our platform governance and security controls, and how?",
    userId: "admin",
    userDisplayName: "admin",
    projectId: session.projectId,
    projectKey: null,
  });

  console.log("\n=== ROUND RESULT ===");
  console.log(`Mode: ${result.mode}`);
  console.log(`Topic: ${result.topic}`);
  console.log(`Turns generated: ${result.turns.length}`);
  console.log(`Supervisor Topic: ${result.supervisor.activeTopic}`);
  console.log(`Supervisor Consensus: ${result.supervisor.consensusLevel}%`);

  const updatedNotes = await db.select().from(supervisorNotes).where(eq(supervisorNotes.sessionId, session.id));
  console.log(`Supervisor Notes Count in DB: ${updatedNotes.length}`);

  process.exit(0);
}

testSubstantiveRound().catch(err => {
  console.error("Round Error:", err);
  process.exit(1);
});
