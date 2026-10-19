import "dotenv/config";
import { db } from "../database_service.js";
import { operationalCycles } from "@shared/schema/index.js";
import { desc } from "drizzle-orm";

async function main() {
  const [cycle] = await db.select().from(operationalCycles).orderBy(desc(operationalCycles.createdAt)).limit(1);
  if (cycle) {
    console.log("=== Last Seeded Cycle Details ===");
    console.log(`ID: ${cycle.id}`);
    console.log(`Name: ${cycle.name}`);
    console.log(`Recurrence: ${cycle.recurrence}`);
    console.log(`Start Date: ${cycle.startDate}`);
    console.log(`End Date: ${cycle.endDate}`);
    console.log(`Metadata Recurrence: ${(cycle.metadata as any)?.recurrence}`);
    console.log(`Metadata DurationDays: ${(cycle.metadata as any)?.durationDays}`);
    console.log(`Metadata ExcludeWeekends: ${(cycle.metadata as any)?.excludeWeekends}`);
    console.log(`Has ExecutionPlan: ${!!(cycle as any).executionPlan || !!(cycle.metadata as any)?.blueprints}`);
  } else {
    console.log("No cycle found!");
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
