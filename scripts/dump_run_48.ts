
import { db } from "../server/db/index.js";
import { missionRuns, missions } from "../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function dumpRun() {
  const runs = await db.select().from(missionRuns).orderBy(desc(missionRuns.id)).limit(10);
  console.log("--- RECENT MISSION RUNS ---");
  runs.forEach(r => {
    console.log(`ID: ${r.id}, MissionID: ${r.missionId}, Name: ${r.name}, Status: ${r.status}`);
  });
  
  const runId = 48;
  const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);
  if (run) {
    console.log("\n--- DETAILED RUN 48 ---");
    console.log(JSON.stringify(run, null, 2));
  } else {
    console.log(`\nRun ${runId} not found in listing.`);
  }
  process.exit(0);
}

dumpRun().catch(err => {
  console.error(err);
  process.exit(1);
});
