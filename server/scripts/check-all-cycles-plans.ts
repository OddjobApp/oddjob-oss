import "dotenv/config";
import { db } from "../db/index.js";
import { operationalCycles } from "../../shared/schema/index.js";

async function main() {
  const cycles = await db.select().from(operationalCycles);
  console.log(`Found ${cycles.length} operational cycles:`);
  for (const c of cycles) {
    console.log(`- ID: ${c.id}, Name: "${c.name}", Status: "${c.status}"`);
    console.log(`  Execution Plan exists? ${c.executionPlan ? "YES" : "NO"}`);
    if (c.executionPlan) {
      console.log(`  Execution Plan:`, JSON.stringify(c.executionPlan, null, 2));
    }
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
