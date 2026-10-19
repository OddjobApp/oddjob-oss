import "dotenv/config";
import { db } from "../db/index.js";
import { pipelineStepExecutions } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
  const execId = 40;
  const steps = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, execId));
  for (const s of steps) {
    console.log(`Step ID: ${s.id}, Output: ${s.output}`);
    console.log(`Status: ${s.status}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

