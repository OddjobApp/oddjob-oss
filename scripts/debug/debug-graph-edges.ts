
import 'dotenv/config';
import { db } from "@server/database_service.js";
import { knowledgeNodes, knowledgeEdges } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function debug() {
    console.log("Debugging SUPPORTS edges...");

    // Get one SUPPORTS edge
    const edge = await db.query.knowledgeEdges.findFirst({
        where: eq(knowledgeEdges.relation, "SUPPORTS")
    });

    if (edge) {
        console.log("Edge found:", edge);
        // Fetch source and target manually
        const source = await db.query.knowledgeNodes.findFirst({ where: eq(knowledgeNodes.id, edge.sourceId) });
        const target = await db.query.knowledgeNodes.findFirst({ where: eq(knowledgeNodes.id, edge.targetId) });

        console.log("Source Node:", source);
        console.log("Target Node:", target);
    } else {
        console.log("No SUPPORTS edge found.");
    }

    console.log("\nDebugging CONTAINS edges...");
    // Get one CONTAINS edge
    const containsEdge = await db.query.knowledgeEdges.findFirst({
        where: eq(knowledgeEdges.relation, "CONTAINS")
    });

    if (containsEdge) {
        console.log("Edge found:", containsEdge);
        const source = await db.query.knowledgeNodes.findFirst({ where: eq(knowledgeNodes.id, containsEdge.sourceId) });
        const target = await db.query.knowledgeNodes.findFirst({ where: eq(knowledgeNodes.id, containsEdge.targetId) });

        console.log("Source Node:", source);
        console.log("Target Node:", target);
    } else {
        console.log("No CONTAINS edge found.");
    }

    process.exit(0);
}

debug().catch(console.error);
