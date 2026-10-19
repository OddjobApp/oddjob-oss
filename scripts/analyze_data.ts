
import { db } from "../server/db/index.js";
import { knowledgeNodes, knowledgeEdges } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

async function analyze() {
    console.log("Analyzing Knowledge Graph Data...");

    // 1. Count Nodes by Label
    const nodeCounts = await db.select({
        label: knowledgeNodes.label,
        count: sql<number>`count(*)`
    })
        .from(knowledgeNodes)
        .groupBy(knowledgeNodes.label);

    console.log("\nNode Distribution by Label:");
    nodeCounts.forEach(r => console.log(`- ${r.label}: ${r.count}`));

    // 2. Count Edges by Relation
    const edgeCounts = await db.select({
        relation: knowledgeEdges.relation,
        count: sql<number>`count(*)`
    })
        .from(knowledgeEdges)
        .groupBy(knowledgeEdges.relation);

    console.log("\nEdge Distribution by Relation:");
    edgeCounts.forEach(r => console.log(`- ${r.relation}: ${r.count}`));

    // 3. Sample Data (Top 5 Nodes)
    const sampleNodes = await db.select().from(knowledgeNodes).limit(5);
    console.log("\nSample Nodes:");
    sampleNodes.forEach(n => console.log(`- [${n.label}] ${n.name} (Source: ${n.extractionSources})`));

    process.exit(0);
}

analyze().catch(err => {
    console.error(err);
    process.exit(1);
});
