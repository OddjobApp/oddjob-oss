import "dotenv/config";
import { db } from "../db/index.js";
import { missionRuns } from "../../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function main() {
  const [run] = await db.select().from(missionRuns).where(eq(missionRuns.missionId, 35)).orderBy(desc(missionRuns.createdAt)).limit(1);
  if (run) {
    console.log(`Run ID: ${run.id}`);
    console.log(`Mission Context: ${JSON.stringify(run.missionContext, null, 2)}`);
  } else {
    console.log("No runs found for Mission 35");
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

