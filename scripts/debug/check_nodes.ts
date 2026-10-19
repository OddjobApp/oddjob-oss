
import 'dotenv/config';
import { db } from "@server/database_service.js";
import { knowledgeNodes, knowledgeEdges } from "../../shared/schema/index.js";
import { count, desc } from "drizzle-orm";

async function check() {
    try {
        const [nodeCount] = await db.select({ count: count() }).from(knowledgeNodes);
        const [edgeCount] = await db.select({ count: count() }).from(knowledgeEdges);

        console.log("Knowledge Nodes:", nodeCount.count);
        console.log("Knowledge Edges:", edgeCount.count);

        // List recent nodes to check for bad data
        const nodes = await db.select().from(knowledgeNodes).orderBy(desc(knowledgeNodes.createdAt)).limit(20);
        console.log("Nodes found:", nodes.length);
        nodes.forEach(n => {
            console.log(`Node [${n.id}]: Label="${n.label}", Name="${n.name.substring(0, 100)}..." (Length: ${n.name.length})`);
        });

    } catch (err) {
        console.error("Error querying DB:", err);
    }
    process.exit(0);
}

check();
