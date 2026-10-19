import { db } from "../server/db/index.js";
import { agentCards } from "../shared/schema/agent-cards.js";
import { projects } from "../shared/schema/projects.js";
import { eq } from "drizzle-orm";

async function main() {
  console.log("=== Checking Projects & Agent Cards ===");
  const allProjects = await db.select().from(projects);
  console.log(`Total projects in DB: ${allProjects.length}`);
  for (const p of allProjects.slice(0, 5)) {
    console.log(` - Project #${p.id}: key='${p.key}', name='${p.name}', orgId=${p.organizationId}, status=${p.status}`);
  }

  const allCards = await db.select().from(agentCards);
  console.log(`Total agent_cards in DB: ${allCards.length}`);
  for (const c of allCards.slice(0, 5)) {
    console.log(` - Agent #${c.id}: name='${c.name}', orgId=${c.organizationId}, enabled=${c.enabled}`);
  }

  // Count by org
  const orgCounts = await db.execute("SELECT organization_id, count(*) as count FROM agent_cards GROUP BY organization_id");
  console.log("Agent cards by org:", orgCounts.rows);

  const projOrgCounts = await db.execute("SELECT organization_id, count(*) as count FROM projects GROUP BY organization_id");
  console.log("Projects by org:", projOrgCounts.rows);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
