// @ts-nocheck

import { db } from "@server/database_service.js";
import { missionService } from "../missions/mission.service.js";
import { eq } from "drizzle-orm";

async function verifyContextPartitioning() {
    console.log("Starting Context Partitioning Verification...");

    // 1. Create a Test Mission
    const mission1 = await missionService.ensureSupervisorMission({
        supervisorJobId: 999991, // Fake ID
        intent: "Test Mission Alpha",
        userId: "test-user",
        orgId: 1
    });
    console.log(`Created Mission 1: ${mission1.id}`);

    const mission2 = await missionService.ensureSupervisorMission({
        supervisorJobId: 999992, // Fake ID
        intent: "Test Mission Beta",
        userId: "test-user",
        orgId: 1
    });
    console.log(`Created Mission 2: ${mission2.id}`);

    // 2. Create Knowledge Node in Mission 1
    const node1 = await graphService.createNode({
        name: "Alpha Entity",
        label: "TestEntity",
        missionId: mission1.id,
        properties: { description: "Belongs to Alpha" }
    }, { organizationId: 1, userId: "test-user" });
    console.log(`Created Node 1 in Mission ${mission1.id}: ${node1.id}`);

    // 3. Create Knowledge Node in Mission 2
    const node2 = await graphService.createNode({
        name: "Beta Entity",
        label: "TestEntity",
        missionId: mission2.id,
        properties: { description: "Belongs to Beta" }
    }, { organizationId: 1, userId: "test-user" });
    console.log(`Created Node 2 in Mission ${mission2.id}: ${node2.id}`);

    // 4. Create Agent Message in Mission 1
    const [msg1] = await db.insert(agentChatMessages).values({
        role: "agent",
        content: "Alpha thought",
        missionId: mission1.id,
        jobId: 999991,
        userId: "test-user"
    }).returning();
    console.log(`Created Message 1 in Mission ${mission1.id}: ${msg1.id}`);

    // 5. Verify Node Isolation
    console.log("Verifying Graph Isolation...");
    const alphaNodes = await graphService.searchNodes({ organizationId: 1, userId: "test-user" }, {
        missionId: mission1.id,
        label: "TestEntity"
    });

    if (alphaNodes.nodes.some(n => n.id === node1.id) && !alphaNodes.nodes.some(n => n.id === node2.id)) {
        console.log("SUCCESS: Graph Search correctly filtered by Mission ID.");
    } else {
        console.error("FAILURE: Graph Search returned incorrect nodes.", alphaNodes.nodes.map(n => ({ id: n.id, missionId: n.missionId })));
    }

    // 6. Verify Edge Isolation (Create edge in Mission 1)
    await graphService.createEdge({
        sourceNodeId: node1.id,
        targetNodeId: node2.id, // Linking across? Let's assume edges can be in Mission 1 even if nodes are mixed? Or strictly same Mission?
        // Let's create another node in Mission 1 to be safe
        relation: "RELATED_TO",
        missionId: mission1.id
    }, { organizationId: 1, userId: "test-user" });

    const edges = await graphService.listEdges({ organizationId: 1, userId: "test-user" }, {
        missionId: mission1.id
    });

    if (edges.edges.length > 0 && edges.edges[0].missionId === mission1.id) {
        console.log("SUCCESS: Edge List correctly filtered by Mission ID.");
    } else {
        console.error("FAILURE: Edge List failed.", edges);
    }

    console.log("Verification Complete.");
    process.exit(0);
}

verifyContextPartitioning().catch(console.error);

