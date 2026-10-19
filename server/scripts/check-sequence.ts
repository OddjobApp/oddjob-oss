import "dotenv/config";
import { db } from "../db/index.js";
import { missionRuns } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
  const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, 72)).limit(1);
  console.log(JSON.stringify(run.pipelineSequence, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

