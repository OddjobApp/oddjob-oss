import { db } from "../server/db/index.js";
import { 
  missions, 
  pipelines, 
  missionRuns,
  orgs
} from "../shared/schema/index.js";
import { eq, like } from "drizzle-orm";

async function triggerMissions() {
  console.log("--- Triggering Mission Runs ---");

  const [org] = await db.select().from(orgs).limit(1);
  if (!org) {
    console.error("No organization found.");
    process.exit(1);
  }

  const missionNames = ["Project Aegis", "Project Velocity", "Project Clarity"];

  for (const name of missionNames) {
    const [mission] = await db.select().from(missions).where(eq(missions.name, name)).limit(1);
    if (!mission) {
      console.warn(`Mission not found: ${name}`);
      continue;
    }

    const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.name, `${name} Pipeline`)).limit(1);
    if (!pipeline) {
      console.warn(`Pipeline not found for mission: ${name}`);
      continue;
    }

    // Create Mission Run
    const [run] = await db.insert(missionRuns).values({
      missionId: mission.id,
      organizationId: org.id,
      name: `${name} Run - Automated Test`,
      status: "active",
      pipelineSequence: [pipeline.id],
      currentPipelineId: pipeline.id,
      currentStepIndex: 0,
      missionContext: {},
      createdBy: "system",
      reasoningProtocol: "json_manifest"
    }).returning();

    console.log(`Triggered Run for ${name}: ID ${run.id}`);
  }

  process.exit(0);
}

triggerMissions().catch(err => {
  console.error(err);
  process.exit(1);
});
