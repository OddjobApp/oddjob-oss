import "dotenv/config";
import { db } from "../db/index.js";
import { pipelineExecutions } from "../../shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";

async function main() {
  const execs = await db.select().from(pipelineExecutions).where(inArray(pipelineExecutions.id, [40, 41])).orderBy(pipelineExecutions.id);
  console.log(JSON.stringify(execs, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

