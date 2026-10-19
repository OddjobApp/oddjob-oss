import "dotenv/config";
import { db } from "../db/index.js";
import { pipelineExecutions, pipelineSteps } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
  const [exec] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, 36)).limit(1);
  console.log(`Pipeline ID: ${exec.pipelineId}`);
  
  const steps = await db.select().from(pipelineSteps).where(eq(pipelineSteps.pipelineId, exec.pipelineId));
  console.log(JSON.stringify(steps, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

