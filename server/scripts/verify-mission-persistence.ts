// @ts-nocheck

import { db } from "@server/database_service.js";
import { eq, and } from "drizzle-orm";

async function verifyMissionPersistence() {
    console.log("Starting Robust Mission Persistence Verification...");

    try {
        // 1. Create Test Missions directly (avoid service overhead)
        const [wg1] = await db.insert(missions).values({
            name: "Partition Test Group A",
            objective: "Verification A",
            type: "manual",
            organizationId: 1,
            createdBy: "tester"
        }).returning();

        const [wg2] = await db.insert(missions).values({
            name: "Partition Test Group B",
            objective: "Verification B",
            type: "manual",
            organizationId: 1,
            createdBy: "tester"
        }).returning();

        console.log(`Created Missions: ${wg1.id}, ${wg2.id}`);

        // 2. Insert Knowledge Nodes directly (Bypass embedding service)
        const [nodeA] = await db.insert(knowledgeNodes).values({
            name: "Node A",
            label: "TestEntity",
            missionId: wg1.id,
            organizationId: 1,
            verificationStatus: "verified"
        }).returning();

        const [nodeB] = await db.insert(knowledgeNodes).values({
            name: "Node B",
            label: "TestEntity",
            missionId: wg2.id,
            organizationId: 1,
            verificationStatus: "verified"
        }).returning();

        console.log(`Created Nodes: ${nodeA.id} (WG ${wg1.id}), ${nodeB.id} (WG ${wg2.id})`);

        // 2.5 Create Dummy Job (for FK constraint)
        const [dummyJob] = await db.insert(jobs).values({
            createdBy: "tester",
            organizationId: 1,
            type: "ai_agent",
            name: `Dummy Job ${Date.now()}`,
            lifecycleStatus: "active",
            config: { goal: "test" },
            lastTestStatus: "success", // Valid status
            outputStorageEnabled: false,
            enableKnowledgeStore: false,
            tool: "None"
        }).returning();
        console.log(`Created Dummy Job: ${dummyJob.id}`);

        // 3. Insert Agent Chat Messages directly
        await db.insert(agentChatMessages).values({
            role: "user",
            content: "Message for A",
            missionId: wg1.id,
            jobId: dummyJob.id,
            userId: "tester"
        });

        await db.insert(agentChatMessages).values({
            role: "user",
            content: "Message for B",
            missionId: wg2.id,
            jobId: dummyJob.id,
            userId: "tester"
        });

        console.log("Created Chat Messages.");

        // 4. Insert Agent Run Step
        await db.insert(agentRunSteps).values({
            type: "thought",
            content: "Thinking about A",
            missionId: wg1.id,
            runId: "run-123",
            jobId: dummyJob.id
        });

        console.log("Created Run Steps.");

        // 5. Verify Graph Service Search (The real test)
        console.log("Testing GraphService.searchNodes for WG A...");
        const searchResultA = await graphService.searchNodes(
            { organizationId: 1, userId: "tester" },
            { missionId: wg1.id, label: "TestEntity" }
        );

        const foundA = searchResultA.nodes.some(n => n.id === nodeA.id);
        const foundB = searchResultA.nodes.some(n => n.id === nodeB.id);

        if (foundA && !foundB) {
            console.log("✅ SUCCESS: Graph Search filtered correctly for Mission A.");
        } else {
            console.error("❌ FAILURE: Graph Search Leakage!", { foundA, foundB, nodes: searchResultA.nodes.map(n => ({ id: n.id, wg: n.missionId })) });
        }

        // 6. Verify Run Step Query
        const stepsA = await db.select().from(agentRunSteps).where(eq(agentRunSteps.missionId, wg1.id));
        if (stepsA.length === 1 && stepsA[0].content === "Thinking about A") {
            console.log("✅ SUCCESS: Agent Run Steps partitioned correctly.");
        } else {
            console.error("❌ FAILURE: Agent Run Steps verification failed.", stepsA);
        }

    } catch (err: any) {
        console.error("CRITICAL FAILURE during verification:", err);
        process.exit(1);
    }

    console.log("Verification Complete.");
    process.exit(0);
}

verifyMissionPersistence();

