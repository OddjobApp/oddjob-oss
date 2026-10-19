
import { db } from "@server/database_service.js";
import { agentDeployments } from "../../shared/schema";

async function listDeployments() {
    const all = await db.select().from(agentDeployments);
    console.log(JSON.stringify(all, null, 2));
}

listDeployments().catch(console.error);
