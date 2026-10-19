import "dotenv/config";
import { missionService } from "@domain/mission/core/mission.service.js";
import { db } from "@server/database_service.js";
import { missions, missionMembers, pipelines, pipelineSteps, missionRuns } from "@shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function main() {
  const missionId = 33; // Mission 33 has job members
  console.log(`Testing Mission Delegation for Mission ${missionId}...`);

  const result = await missionService.launchMission(33, "system", 1);
  if (!result.success) {
    console.error(`Launch failed: ${result.error}`);
    process.exit(1);
  }

  console.log(`Mission launched successfully. Run ID: ${result.missionRunId}`);

  // Check if synthetic pipelines were created for the members
  const members = await db.select().from(missionMembers).where(eq(missionMembers.missionId, missionId));
  console.log(`Members count: ${members.length}`);

  for (const m of members) {
    if (m.entityType === 'job') {
      const proxyName = `[Agent Proxy] Technical Specification Writer`; // One example
      const [proxy] = await db.select().from(pipelines).where(eq(pipelines.name, proxyName)).limit(1);
      if (proxy) {
         console.log(`Found proxy pipeline for job: ${proxy.id}`);
      }
    }
  }

  if (!result.missionRunId) {
    console.error("No missionRunId returned from launchMission");
    process.exit(1);
  }

  // Wait a bit for the supervisor to start
  console.log("Waiting for supervisor to initialize...");
  await new Promise(resolve => setTimeout(resolve, 5000));

  const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, result.missionRunId as number)).limit(1) as any;
  console.log(`Run ${run.id} Status: ${run.status}`);
  console.log(`Pipeline Sequence: ${JSON.stringify(run.pipelineSequence)}`);
  
  if (run.pipelineSequence && run.pipelineSequence.length > 0) {
      console.log("SUCCESS: Mission launched with a pipeline sequence!");
  } else {
      console.log("FAILURE: Mission launched with empty sequence.");
  }
}

main().catch(err => {
  console.error("CRITICAL ERROR during test:");
  console.error(err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});

