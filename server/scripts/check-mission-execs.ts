import "dotenv/config";
import { db } from "../db/index.js";
import { pipelineExecutions } from "../../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function main() {
  const missionId = 33;
  // Use startedAt instead of createdAt
  const execs = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.missionId, missionId)).orderBy(desc(pipelineExecutions.startedAt)).limit(10);
  console.log("Executions for Mission 33:", JSON.stringify(execs, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

