import { db } from "../database_service.js";
import { operationalCycles } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
  const cycles = await db.select({ id: operationalCycles.id, name: operationalCycles.name, orgId: operationalCycles.organizationId, status: operationalCycles.status }).from(operationalCycles).where(eq(operationalCycles.organizationId, 291));
  console.log(`\nCycles for org 291 (${cycles.length}):`);
  for (const c of cycles) {
    console.log(`  ID: ${c.id}, Name: "${c.name}", Status: ${c.status}`);
  }
  process.exit(0);
}
main();
