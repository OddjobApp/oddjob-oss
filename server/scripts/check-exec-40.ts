import "dotenv/config";
import { db } from "../db/index.js";
import { pipelineExecutions, pipelines } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
  const execId = 40;
  const [exec] = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, execId)).limit(1);
  if (exec) {
    console.log(`Execution 40 Pipeline ID: ${exec.pipelineId}`);
    console.log(`Execution 40 Status: ${exec.status}`);
    const [p] = await db.select().from(pipelines).where(eq(pipelines.id, exec.pipelineId)).limit(1);
    console.log(`Pipeline Name: ${p?.name}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

