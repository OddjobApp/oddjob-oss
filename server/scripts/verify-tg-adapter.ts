import { trustGraphService } from "../domain/integrations/trustgraph/adapter.js";
import { db } from "../database_service.js";
import { missionRuns } from "@shared/schema/index.js";
import { desc } from "drizzle-orm";

async function testAdapter() {
  console.log("--- TrustGraph Adapter Verification ---");
  
  // 1. Use a known mission run with data (Mission 13 -> Run 16)
  const latestRun = { id: 16, missionId: 13 };

  if (!latestRun) {
    console.error("No mission runs found in database.");
    return;
  }

  console.log(`Testing with Mission Run ID: ${latestRun.id} (Mission ${latestRun.missionId})`);

  // 2. Run the adapter
  try {
    const { entities, relationships } = await trustGraphService.fromMission(latestRun.id);
    
    console.log(`\nResults:`);
    console.log(`Entities: ${entities.length}`);
    console.log(`Relationships: ${relationships.length}`);

    if (entities.length > 0) {
      console.log("\nSample Entity:");
      console.log(JSON.stringify(entities[0], null, 2));
    }

    if (relationships.length > 0) {
      console.log("\nSample Relationship:");
      console.log(JSON.stringify(relationships[0], null, 2));
    }

    console.log("\n✅ Adapter verification complete.");
  } catch (err: any) {
    console.error("\n❌ Adapter failed:", err.message);
  }
}

testAdapter().catch(console.error);

