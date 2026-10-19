
import { db } from "../server/db/index.js";
import { agentDeployments } from "@shared/schema/index.js";

async function checkAgents() {
    const agents = await db.select().from(agentDeployments);
    console.log("Current Agent Deployments:");
    agents.forEach(a => {
        console.log(`- [Slug: ${a.slug}] ${a.title} (Org: ${a.organizationId})`);
    });
    process.exit(0);
}

checkAgents().catch(err => {
    console.error(err);
    process.exit(1);
});
