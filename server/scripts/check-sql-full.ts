import { db } from "../database_service.js";
import { missionStepAssignments, missionRuns } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function checkFullSql() {
  const query = db.select()
    .from(missionStepAssignments)
    .innerJoin(missionRuns, eq(missionStepAssignments.missionRunId, missionRuns.id))
    .where(and(eq(missionRuns.missionId, 91), eq(missionStepAssignments.status, "completed")));

  const sqlObj = query.toSQL();
  console.log("FULL SQL BEGIN");
  console.log(sqlObj.sql);
  console.log("FULL SQL END");
  process.exit(0);
}

checkFullSql().catch(console.error);

