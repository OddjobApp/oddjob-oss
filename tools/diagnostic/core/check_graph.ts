
import "dotenv/config";
import { db } from "./server/db.js";
import { orgs, knowledgeNodes, knowledgeEdges } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

async function checkGraph() {
    try {
        const [org] = await db.select().from(orgs).where(eq(orgs.name, "KUS")).limit(1);
        console.log("Org KUS info:", JSON.stringify(org, null, 2));

        if (org) {
            const [{ count: nodeCount }] = await db.select({ count: sql<number>`count(*)` })
                .from(knowledgeNodes)
                .where(eq(knowledgeNodes.organizationId, org.id));

            const [{ count: edgeCount }] = await db.select({ count: sql<number>`count(*)` })
                .from(knowledgeEdges)
                .where(eq(knowledgeEdges.organizationId, org.id));

            console.log(`Knowledge Nodes in KUS (ID: ${org.id}):`, nodeCount);
            console.log(`Knowledge Edges in KUS (ID: ${org.id}):`, edgeCount);
        } else {
            console.log("Organization 'KUS' not found");
        }

        // Total count as fallback
        const [{ count: totalNodes }] = await db.select({ count: sql<number>`count(*)` }).from(knowledgeNodes);
        console.log("Total Knowledge Nodes in system:", totalNodes);
    } catch (error: any) {
        console.error("Error checking graph:", error.message);
    } finally {
        process.exit(0);
    }
}

checkGraph();
