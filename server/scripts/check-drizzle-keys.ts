import { db } from "../database_service.js";
import { missionStepAssignments, missionRuns } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function checkStructure() {
  const deliverables = await db.select()
    .from(missionStepAssignments)
    .innerJoin(missionRuns, eq(missionStepAssignments.missionRunId, missionRuns.id))
    .limit(1);

  if (deliverables.length > 0) {
    console.log("Keys in result row:", Object.keys(deliverables[0]));
  } else {
    console.log("No deliverables found to check.");
  }
}

checkStructure().catch(console.error).finally(() => process.exit(0));

