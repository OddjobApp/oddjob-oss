import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../../../.env") });

import { db } from "../database_service.js";
import { missionStepAssignments, missionRuns } from "../../shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function debugSQL() {
  const query = db.select()
    .from(missionStepAssignments)
    .innerJoin(missionRuns, eq(missionStepAssignments.missionRunId, missionRuns.id))
    .where(and(eq(missionRuns.missionId, 91), eq(missionStepAssignments.status, "completed")));

  console.log("Generated SQL:");
  console.log(query.toSQL());
  process.exit(0);
}

debugSQL().catch(console.error);

