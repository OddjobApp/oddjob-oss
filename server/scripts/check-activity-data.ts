
import { db } from "@server/database_service.js";
import { agentRunSteps, missionRuns } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function checkData() {
  const run76 = await db.select().from(missionRuns).where(eq(missionRuns.id, 76));
  console.log("MISSION RUN 76:");
  console.log(JSON.stringify(run76, null, 2));

  const run77 = await db.select().from(missionRuns).where(eq(missionRuns.id, 77));
  console.log("\nMISSION RUN 77:");
  console.log(JSON.stringify(run77, null, 2));

  process.exit(0);
}

checkData();

