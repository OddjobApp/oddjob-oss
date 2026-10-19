import "dotenv/config";
import { db } from "../db/index.js";
import { pipelineStepExecutions } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
  const stepExecId = 43;
  const [s] = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.id, stepExecId)).limit(1);
  if (s) {
    console.log(`Step 43 Output: ${s.output}`);
    console.log(`Step 43 Status: ${s.status}`);
    console.log(`Step 43 Output Name: ${s.outputName}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

