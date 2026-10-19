
import 'dotenv/config';
import { db } from "../server/db/index.js";
import { knowledgeNodes, orgs } from "../shared/schema/index";
import { sql, eq } from "drizzle-orm";

async function main() {
    console.log("Node counts by Organization:");
    const counts = await db.select({
        orgId: knowledgeNodes.organizationId,
        orgName: orgs.name,
        count: sql`count(*)`
    })
        .from(knowledgeNodes)
        .leftJoin(orgs, eq(knowledgeNodes.organizationId, orgs.id))
        .groupBy(knowledgeNodes.organizationId, orgs.name);

    console.log(JSON.stringify(counts, null, 2));
    process.exit(0);
}

main().catch(console.error);
