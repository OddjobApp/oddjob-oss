import "dotenv/config";
import { db } from "../db/index.js";
import { missionRuns, missions } from "../../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function main() {
  console.log("--- Checking Status for Mission 33 and Run 72 ---");
  
  const missionId = 33;
  const [mission] = await db.select().from(missions).where(eq(missions.id, missionId)).limit(1);
  const runs = await db.select().from(missionRuns).where(eq(missionRuns.missionId, missionId)).orderBy(desc(missionRuns.id));

  console.log(JSON.stringify({
    mission: mission || "NOT FOUND",
    runsCount: runs.length,
    runs: runs.map(r => ({
      id: r.id,
      status: r.status,
      pipelineExecutionId: r.pipelineExecutionId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }))
  }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

