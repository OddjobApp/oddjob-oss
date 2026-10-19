
import { graphService } from "@domain/knowledge/core/graph-service.js";
import { createLogger } from "../utils/logger.js";

async function test() {
    // Mock OrgContext
    const orgContext = {
        organizationId: 1,
        userId: "admin",
        isAdmin: true,
        isOrgAdmin: true
    };

    console.log("--- Testing Semantic Graph Enrichment ---");

    try {
        const result = await graphService.getSemanticGraph(orgContext as any, { limit: 100 });

        console.log(`Total Nodes: ${result.nodes.length}`);
        console.log(`Total Edges: ${result.edges.length}`);

        const nodesWithConcepts = result.nodes.filter(n => n.concept);
        console.log(`Nodes with Concepts: ${nodesWithConcepts.length}`);

        if (nodesWithConcepts.length > 0) {
            console.log("\nSample Node with Concept:");
            const sample = nodesWithConcepts[0];
            console.log(`- ID: ${sample.id}`);
            console.log(`- Name: ${sample.name}`);
            console.log(`- Concept: ${sample.concept.name} (ID: ${sample.concept.id})`);
        } else {
            console.log("\n[!] No nodes with concepts found. This is expected if the concept-service hasn't ran auto-linking yet.");
        }

        console.log("\n--- Verification Complete ---");
    } catch (error) {
        console.error("Test failed:", error);
        process.exit(1);
    }
}

test();

