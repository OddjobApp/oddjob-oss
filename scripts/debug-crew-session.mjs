import { db } from "../server/database_service.js";
import { crewSessions, crewTurns, approvalRequests, missionRuns } from "../shared/schema/index.js";
import { eq, desc, sql } from "drizzle-orm";

const sessionKey = "crew-1786919778307-ttrb1xs";

const [session] = await db
  .select()
  .from(crewSessions)
  .where(eq(crewSessions.sessionKey, sessionKey))
  .limit(1);

if (!session) {
  console.log("SESSION NOT FOUND");
  process.exit(0);
}

console.log("SESSION:", {
  id: session.id,
  sessionKey: session.sessionKey,
  orgId: session.organizationId,
  createdAt: session.createdAt,
});

const turns = await db
  .select()
  .from(crewTurns)
  .where(eq(crewTurns.sessionId, session.id))
  .orderBy(crewTurns.id);

console.log("\nTURNS:", turns.length);
for (const t of turns) {
  console.log({
    id: t.id,
    round: t.round,
    speakerType: t.speakerType,
    speakerName: t.speakerName,
    intent: t.intent,
    topic: t.topic,
    contentPreview: (t.content || "").slice(0, 200),
  });
}

const approvals = await db
  .select()
  .from(approvalRequests)
  .where(eq(approvalRequests.organizationId, session.organizationId))
  .orderBy(desc(approvalRequests.id))
  .limit(50);

const researchApprovals = approvals.filter((a) => {
  const m = a.modifiedOutput;
  return m && (m.kind === "research_mission" || m.sessionKey === sessionKey);
});

console.log("\nRESEARCH APPROVALS:", researchApprovals.length);
for (const r of researchApprovals) {
  console.log({
    id: r.id,
    status: r.status,
    toolName: r.toolName,
    modifiedOutput: r.modifiedOutput,
  });
}

const runIds = researchApprovals
  .map((r) => r.modifiedOutput?.missionRunId)
  .filter(Boolean);

if (runIds.length) {
  for (const runId of runIds) {
    const [run] = await db
      .select()
      .from(missionRuns)
      .where(eq(missionRuns.id, runId))
      .limit(1);
    if (run) {
      console.log("\nMISSION RUN", runId, {
        status: run.status,
        missionId: run.missionId,
        missionContext: run.missionContext,
      });
    }
  }
}

// Also search mission runs whose context references this sessionKey
const runsBySession = await db.execute(sql`
  SELECT id, status, mission_id, mission_context
  FROM mission_runs
  WHERE mission_context::text ILIKE ${"%" + sessionKey + "%"}
  ORDER BY id DESC
  LIMIT 10
`);
console.log("\nRUNS REFERENCING SESSION:", runsBySession.rows ?? runsBySession);

process.exit(0);
