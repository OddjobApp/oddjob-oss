// @ts-nocheck
import 'dotenv/config';
import { graphService } from "@domain/knowledge/core/graph-service.js";

async function main() {
    const orgContext = { organizationId: 1, isAdmin: true, isOrgAdmin: true } as any;
    console.log("Testing getSemanticGraph API...");
    try {
        const result = await graphService.getSemanticGraph(orgContext, { limit: 100 });
        console.log("Nodes returned:", result.nodes.length);
        console.log("Edges returned:", result.edges.length);
        if (result.nodes.length > 0) {
            console.log("First Node:", JSON.stringify({
                id: result.nodes[0].id,
                name: result.nodes[0].name,
                label: result.nodes[0].label,
                concept: result.nodes[0].concept
            }, null, 2));
        }
    } catch (e) {
        console.error("API Call Failed:", e);
    }
    process.exit(0);
}

main();

