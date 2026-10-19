import { db } from "../database_service.js";
import { missionRuns } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function findRuns(missionId: number) {
  const results = await db
    .select({ id: missionRuns.id, name: missionRuns.name })
    .from(missionRuns)
    .where(eq(missionRuns.missionId, missionId))
    .limit(5);
  
  console.log(`Runs for mission ${missionId}:`);
  console.log(results);
}

findRuns(13).catch(console.error);

