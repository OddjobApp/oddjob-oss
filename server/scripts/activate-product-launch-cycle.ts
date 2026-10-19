import { db } from "../database_service.js";
import { operationalCycles } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
  await db.update(operationalCycles).set({ status: "active", updatedAt: new Date() }).where(eq(operationalCycles.id, 202));
  console.log("✅ Cycle 202 status set to 'active'");
  process.exit(0);
}
main();
