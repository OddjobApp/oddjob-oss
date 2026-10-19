import "dotenv/config";
import { db } from "../database_service.js";
import { operationalCycles, missions, missionAppBindings, missionRuns } from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";

async function main() {
  const runs = await db.select().from(missionRuns).where(eq(missionRuns.cycleId, 202));
  console.log("Runs for cycle 202:", JSON.stringify(runs, null, 2));
  
  if (runs.length > 0) {
    const missionIds = runs.map(r => r.missionId).filter((id): id is number => id !== null);
    
    if (missionIds.length > 0) {
      const m = await db.select().from(missions).where(inArray(missions.id, missionIds));
      console.log("Missions:", JSON.stringify(m, null, 2));

      const binds = await db.select().from(missionAppBindings).where(inArray(missionAppBindings.missionId, missionIds));
      console.log("Binds:", JSON.stringify(binds, null, 2));
    }
  }

  process.exit(0);
}
main().catch(console.error);
