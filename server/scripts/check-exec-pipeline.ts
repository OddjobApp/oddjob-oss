import "dotenv/config";
import { db } from "../db/index.js";
import { pipelineExecutions, pipelines } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
  const execId = 41;
  const [exec] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, execId)).limit(1);
  if (exec) {
    console.log(`Execution 41 Pipeline ID: ${exec.pipelineId}`);
    const [p] = await db.select().from(pipelines).where(eq(pipelines.id, exec.pipelineId)).limit(1);
    console.log(`Pipeline Name: ${p?.name}`);
    console.log(`Pipeline Labels: ${JSON.stringify(p?.labels)}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

