import { db } from "../database_service.js";
import { missions, jobs } from "@shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";

async function checkMissions() {
  const activeMissions = await db.select().from(missions).where(eq(missions.status, "active"));
  console.log(`=== ACTIVE MISSIONS (${activeMissions.length}) ===`);

  for (const m of activeMissions) {
    console.log(`\nMission [${m.id}] Org: ${m.organizationId}, Name: "${m.name}", Objective: "${m.objective?.substring(0, 80)}"`);
    console.log(`  Updated At: ${m.updatedAt}, Created At: ${m.createdAt}`);
  }

  process.exit(0);
}

checkMissions().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
