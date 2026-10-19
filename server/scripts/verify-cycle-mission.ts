import { db } from "../database_service.js";
import { cycleBlueprints, missions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function verify() {
  const bps = await db.select().from(cycleBlueprints).where(eq(cycleBlueprints.cycleId, 160));
  
  let valid = 0;
  let invalid = 0;
  
  for (const bp of bps) {
    if (bp.type === "mission") {
      const config = bp.config as any;
      if (typeof config?.missionId === "number") {
        valid++;
      } else {
        invalid++;
        console.log(`Blueprint ${bp.name} has invalid missionId: ${config?.missionId}`);
      }
    }
  }
  
  console.log(`Cycle Blueprints: ${valid} valid missionIds, ${invalid} invalid`);
  
  const orgMissions = await db.select().from(missions).where(eq(missions.organizationId, 257));
  console.log(`Missions in org 257: ${orgMissions.length}`);
  const linkedMissions = orgMissions.filter((m) => {
    const wb = m.workflowBlueprint as any;
    return typeof wb?.pipelineId === "number";
  });
  console.log(`Missions linked to pipelines: ${linkedMissions.length}`);
  
  process.exit(0);
}

verify();
