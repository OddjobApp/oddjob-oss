import "dotenv/config";
import { db } from "../db/index.js";
import { missionRuns, missions } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
  console.log("--- Checking trace of Mission Runs 67 and 69 ---");
  const results = [];
  for (const id of [67, 69]) {
    const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, id)).limit(1);
    if (run) {
      const [mission] = await db.select().from(missions).where(eq(missions.id, parseInt(String(run.missionId)))).limit(1);
      results.push({ run, mission });
    }
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

