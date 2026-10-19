import { db } from "../server/db/index.js";
import { agentDeployments } from "../shared/schema/agent-deployments.js";
import { eq } from "drizzle-orm";

async function audit() {
  const agentIds = [51, 52, 53]; // IDs from previous runs
  console.log("--- Agent Trait Audit ---");
  for (const id of agentIds) {
    const [dep] = await db.select().from(agentDeployments).where(eq(agentDeployments.id, id)).limit(1);
    if (dep) {
       console.log(`Agent ${id} (${dep.title}): Traits=${JSON.stringify(dep.oceanTraits)}`);
    } else {
       console.log(`Agent ${id} not found.`);
    }
  }
  process.exit(0);
}

audit().catch(err => {
  console.error(err);
  process.exit(1);
});
