import "dotenv/config";
import { db } from "../db/index.js";
import { missionRuns } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
  const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, 74)).limit(1);
  if (run) {
    console.log(`Run 74 Resume Condition: ${JSON.stringify(run.resumeCondition, null, 2)}`);
    console.log(`Status: ${run.status}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

