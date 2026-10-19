import "dotenv/config";
import { db } from "../db/index.js";
import { missionRuns } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
  const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, 74)).limit(1);
  if (run) {
    console.log(`Run 74 Mission Context: ${JSON.stringify(run.missionContext, null, 2)}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

