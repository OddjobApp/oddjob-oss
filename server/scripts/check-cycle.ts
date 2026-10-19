import "dotenv/config";
import { db } from "../db/index.js";
import { operationalCycles } from "../../shared/schema/index.js";
import { desc } from "drizzle-orm";

async function main() {
  const [cycle] = await db.select().from(operationalCycles).orderBy(desc(operationalCycles.createdAt)).limit(1);
  if (cycle) {
    console.log(`Cycle Name: ${cycle.name}`);
    console.log(`Cycle Metadata: ${JSON.stringify(cycle.metadata, null, 2)}`);
  } else {
    console.log("No cycle found!");
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
