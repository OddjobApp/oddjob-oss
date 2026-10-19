import "dotenv/config";
import { db } from "../db/index.js";
import { pipelineExecutions, pipelineStepExecutions } from "../../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function main() {
  const execId = 41;
  const [exec] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, execId)).limit(1);
  console.log("Execution Status:", exec?.status);

  const steps = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, execId)).orderBy(desc(pipelineStepExecutions.id)).limit(5);
  console.log("Steps:", JSON.stringify(steps, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

