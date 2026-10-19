
import "dotenv/config";
import { db } from "../server/db/index.js";
import { knowledgeNodes, knowledgeEdges, knowledgeTopics, knowledgeTopicDocuments } from "../shared/schema/index.js";
import { ilike, or, eq } from "drizzle-orm";

async function run() {
    console.log("MASTER PURGE: Cleaning up Knowledge Graph and Topics...");

    // 1. Delete poisoned nodes
    const nodeCount = await db.delete(knowledgeNodes)
        .where(or(
            ilike(knowledgeNodes.name, "%Reasoning%"),
            ilike(knowledgeNodes.name, "%Step %"),
            ilike(knowledgeNodes.name, "%failed attempt%"),
            ilike(knowledgeNodes.name, "%circular reference%"),
            ilike(knowledgeNodes.name, "%unable to find%")
        ));
    console.log(`Deleted poisoned nodes.`);

    // 2. Delete all edges (safer to just wipe edges since they depend on nodes)
    await db.delete(knowledgeEdges);
    console.log("Deleted all knowledge edges.");

    // 3. Delete orphaned nodes (optional but good)
    // Actually, let's just wipe the nodes and let them re-extract accurately.
    // await db.delete(knowledgeNodes); 

    // 4. Clean up topics
    const topicCount = await db.delete(knowledgeTopics)
        .where(or(
            ilike(knowledgeTopics.name, "%Reasoning%"),
            ilike(knowledgeTopics.name, "%failed%"),
            ilike(knowledgeTopics.name, "%poison%")
        ));
    console.log(`Deleted poisoned topics.`);

    process.exit(0);
}

run();
