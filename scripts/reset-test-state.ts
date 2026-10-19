import { db } from "../server/db/index.js";
import { agentDeployments, missionRuns } from "../shared/schema/index.js";
import { eq, inArray } from "drizzle-orm";

async function reset() {
  console.log("--- Resetting Test State ---");

  // 1. Reset Agent Traits
  const agents = [
    { id: 51, traits: { o: 0.9, c: 0.9, e: 0.3, a: 0.5, n: 0.2 } },
    { id: 52, traits: { o: 0.8, c: 0.95, e: 0.4, a: 0.6, n: 0.1 } }, // Assuming next IDs
    { id: 53, traits: { o: 0.95, c: 0.8, e: 0.7, a: 0.9, n: 0.3 } }
  ];

  for (const agent of agents) {
    await db.update(agentDeployments)
      .set({ oceanTraits: agent.traits, updatedAt: new Date() })
      .where(eq(agentDeployments.id, agent.id));
    console.log(`Reset Traits for Agent ${agent.id}`);
  }

  // 2. Reset Mission Runs
  const runIds = [268, 269, 270];
  await db.update(missionRuns)
    .set({ 
      status: "active", 
      currentStepIndex: -1, 
      isSuccess: null, 
      failureReason: null,
      updatedAt: new Date() 
    })
    .where(inArray(missionRuns.id, runIds));
  
  console.log(`Reset Mission Runs: ${runIds.join(", ")} to index -1`);

  process.exit(0);
}

reset().catch(err => {
  console.error(err);
  process.exit(1);
});
