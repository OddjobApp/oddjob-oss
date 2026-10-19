import "dotenv/config";
import { db } from "../db/index.js";
import { missionBlackboardHistory } from "../../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function main() {
  const missionRunId = 74;
  const history = await db.select().from(missionBlackboardHistory).where(eq(missionBlackboardHistory.missionRunId, missionRunId)).orderBy(desc(missionBlackboardHistory.createdAt));
  console.log("History for Run 74:", JSON.stringify(history, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

