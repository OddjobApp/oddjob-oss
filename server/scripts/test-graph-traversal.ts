// @ts-nocheck

import "dotenv/config";
import { graphService } from "@domain/knowledge/core/graph-service.js";
import { handleExploreRelationships } from "../mcp/handlers/knowledge-graph.js";

async function runTest() {
    try {
        console.log("Setting up test data...");
        const orgContext = { organizationId: 1, userId: "test-user" };

        // Create nodes
        const root = await graphService.createNode({
            name: "TestRootNode_" + Date.now(),
            label: "TestComponent",
            description: "Root node for traversal test"
        }, orgContext);

        const child1 = await graphService.createNode({
            name: "TestChildNode1_" + Date.now(),
            label: "TestService",
            description: "Child 1"
        }, orgContext);

        const child2 = await graphService.createNode({
            name: "TestChildNode2_" + Date.now(),
            label: "TestDatabase",
            description: "Child 2"
        }, orgContext);

        const grandChild = await graphService.createNode({
            name: "TestGrandChild_" + Date.now(),
            label: "TestInfrastructure",
            description: "Grandchild"
        }, orgContext);

        // Create edges
        // Root -> Child1
        await graphService.createEdge({
            sourceNodeId: root.id,
            targetNodeId: child1.id,
            relation: "DEPENDS_ON"
        }, orgContext);

        // Root -> Child2
        await graphService.createEdge({
            sourceNodeId: root.id,
            targetNodeId: child2.id,
            relation: "USES"
        }, orgContext);

        // Child1 -> GrandChild
        await graphService.createEdge({
            sourceNodeId: child1.id,
            targetNodeId: grandChild.id,
            relation: "HOSTED_ON"
        }, orgContext);

        console.log(`Created nodes: Root(${root.id}), Child1(${child1.id}), Child2(${child2.id}), GrandChild(${grandChild.id})`);

        // Test Traversal Depth 1
        console.log("\n--- Testing Depth 1 ---");
        const res1 = await handleExploreRelationships({
            entityName: root.name,
            depth: 1,
            direction: "outgoing"
        }, { organizationId: 1, userId: "test-user" } as any);

        console.log("Depth 1 Result:", JSON.stringify(res1, null, 2));

        // Test Traversal Depth 2
        console.log("\n--- Testing Depth 2 ---");
        const res2 = await handleExploreRelationships({
            entityName: root.name,
            depth: 2,
            direction: "outgoing"
        }, { organizationId: 1, userId: "test-user" } as any);

        console.log("Depth 2 Result:", JSON.stringify(res2, null, 2));

        // Cleanup
        console.log("\nCleaning up...");
        await graphService.deleteNode(root.id, orgContext);
        await graphService.deleteNode(child1.id, orgContext);
        await graphService.deleteNode(child2.id, orgContext);
        await graphService.deleteNode(grandChild.id, orgContext);
        console.log("Cleanup complete.");

    } catch (e: any) {
        console.error("Test Failed:", e);
    }
}

runTest();

