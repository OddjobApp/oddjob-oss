import "dotenv/config";
import { db } from "../db/index.js";
import { missionRuns } from "../../shared/schema/index.js";
import { desc } from "drizzle-orm";

async function main() {
  const [run] = await db.select().from(missionRuns).orderBy(desc(missionRuns.createdAt)).limit(1);
  if (run) {
    console.log(`Latest Run ID: ${run.id}`);
    console.log(`Mission ID: ${run.missionId}`);
    console.log(`Pipeline Sequence: ${JSON.stringify(run.pipelineSequence)}`);
    console.log(`Status: ${run.status}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

