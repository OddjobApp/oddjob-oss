import { db } from "../database_service.js";
import { missionStepAssignments, missionRuns } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function runQuery() {
  console.log("Running Query...");
  try {
    const result = await db.select()
      .from(missionStepAssignments)
      .innerJoin(missionRuns, eq(missionStepAssignments.missionRunId, missionRuns.id))
      .where(and(eq(missionRuns.missionId, 91), eq(missionStepAssignments.status, "completed")));
    
    console.log("Result length:", result.length);
  } catch (e) {
    console.error("Error:", e);
  }
}

runQuery().catch(console.error).finally(() => process.exit(0));

