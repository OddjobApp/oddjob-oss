
import 'dotenv/config';
import { db } from "@server/db/index.js";
import { knowledgeNodes, knowledgeEdges } from "@shared/schema/index.js";

async function clear() {
    try {
        console.log("deleting edges...");
        await db.delete(knowledgeEdges);
        console.log("deleting nodes...");
        await db.delete(knowledgeNodes);
        console.log("Cleared all knowledge graph data.");
    } catch (err) {
        console.error("Error clearing DB:", err);
    }
    process.exit(0);
}

clear();
