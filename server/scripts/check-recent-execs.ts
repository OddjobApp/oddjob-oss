import "dotenv/config";
import { db } from "../db/index.js";
import { pipelineExecutions } from "../../shared/schema/index.js";
import { eq, desc, gte } from "drizzle-orm";

async function main() {
  const missionId = 33;
  const since = new Date("2026-03-19T17:35:00Z");
  const execs = await db.select().from(pipelineExecutions).where(gte(pipelineExecutions.startedAt, since)).orderBy(desc(pipelineExecutions.startedAt));
  console.log("Recent Executions:", JSON.stringify(execs, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

