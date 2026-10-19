
import { db } from "../server/db/index.js";
import { knowledgeNodes, knowledgeEdges } from "../shared/schema/index";
import { sql } from "drizzle-orm";

async function count() {
    try {
        const nodeCount = await db.select({ count: sql<number>`count(*)` }).from(knowledgeNodes);
        const edgeCount = await db.select({ count: sql<number>`count(*)` }).from(knowledgeEdges);

        console.log(`Nodes: ${nodeCount[0].count}`);
        console.log(`Edges: ${edgeCount[0].count}`);

        const edges = await db.select().from(knowledgeEdges).limit(5);
        console.log("Sample edges:", JSON.stringify(edges, null, 2));
    } catch (e) {
        console.error(e);
    }
    process.exit(0);
}

count();
