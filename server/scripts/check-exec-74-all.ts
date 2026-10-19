import "dotenv/config";
import { db } from "../db/index.js";
import { pipelineExecutions } from "../../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function main() {
  const missionRunId = 74;
  const execs = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.missionRunId, missionRunId)).orderBy(desc(pipelineExecutions.startedAt));
  console.log("Executions for Run 74:", JSON.stringify(execs, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

