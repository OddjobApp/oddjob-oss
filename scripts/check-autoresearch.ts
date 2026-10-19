import { db } from "../server/db/index.js";
import { missionShadowRuns, missionRuns, missions } from "@shared/schema/index.js";
import { eq, inArray, desc } from "drizzle-orm";

async function check() {
  console.log("--- AUTORESEARCH STATUS ---");
  
  const activeShadows = await db.select().from(missionShadowRuns).where(eq(missionShadowRuns.status, 'active')).orderBy(desc(missionShadowRuns.createdAt));
  console.log(`Active Shadow Runs (Autoresearch Phase 2): ${activeShadows.length}`);
  
  if (activeShadows.length > 0) {
    for (const s of activeShadows) {
      console.log(`- Shadow Run #${s.id} (Parent Run #${s.parentRunId}): Model ${s.modelId}, Prompt ${s.promptVersion}`);
    }
  }

  const activeMissionRuns = await db.select({
    id: missionRuns.id,
    missionId: missionRuns.missionId,
    status: missionRuns.status,
    pipelineExecutionId: missionRuns.pipelineExecutionId,
    missionName: missions.name
  })
  .from(missionRuns)
  .leftJoin(missions, eq(missionRuns.missionId, missions.id))
  .where(inArray(missionRuns.status, ['active', 'waiting_on_human']))
  .orderBy(desc(missionRuns.createdAt));

  console.log(`\nActive Mission Runs: ${activeMissionRuns.length}`);
  if (activeMissionRuns.length > 0) {
    for (const r of activeMissionRuns) {
      console.log(`- Run #${r.id} for Mission '${r.missionName}' (ID: ${r.missionId}): Status ${r.status}, Exec ID: ${r.pipelineExecutionId}`);
    }
  }
}

check().catch(console.error).finally(() => process.exit());
