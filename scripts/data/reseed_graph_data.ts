
import 'dotenv/config';
import { db } from "../../server/db/index.js";
import { pipelineExecutions, knowledgeNodes, knowledgeEdges, pipelines, jobs } from "@shared/schema";
import { eq } from "drizzle-orm";

async function main() {
    const TARGET_ORG_ID = 7; // Acme Corp
    console.log(`Generating Graph Data for Org ${TARGET_ORG_ID}...`);

    // 1. Get or Create a Pipeline
    let pipeline = await db.query.pipelines.findFirst({
        where: eq(pipelines.organizationId, TARGET_ORG_ID)
    });

    if (!pipeline) {
        console.log("No pipeline found, creating placeholder...");
        // Need a job first
        const [job] = await db.insert(jobs).values({
            name: "Placeholder Job",
            type: "script",
            description: "Auto-generated for graph testing",
            config: {},
            organizationId: TARGET_ORG_ID,
            createdBy: "system",
        }).returning();

        const [newP] = await db.insert(pipelines).values({
            name: "Data Extraction Pipeline",
            organizationId: TARGET_ORG_ID,
            triggerType: "manual",
            createdBy: "system"
        }).returning();
        pipeline = newP;
    }

    // 2. Create Execution
    const [execution] = await db.insert(pipelineExecutions).values({
        pipelineId: pipeline.id,
        organizationId: TARGET_ORG_ID,
        status: "completed",
        startedAt: new Date(),
        completedAt: new Date(),
        createdBy: "system"
    }).returning();

    console.log(`Created Run #${execution.id}`);

    // 3. Create Nodes (Tickets and VINs)
    const tickets = ["TICKET-101", "TICKET-102", "TICKET-103"];
    const vins = ["VIN-A111", "VIN-B222", "VIN-C333"];

    const createdNodes = [];

    for (const t of tickets) {
        const [n] = await db.insert(knowledgeNodes).values({
            organizationId: TARGET_ORG_ID,
            pipelineExecutionId: execution.id,
            label: "Ticket",
            name: t,
            verificationStatus: "verified",
            createdBy: "system"
        }).returning();
        createdNodes.push(n);
    }

    for (const v of vins) {
        const [newNode] = await db.insert(knowledgeNodes).values({
            organizationId: TARGET_ORG_ID,
            pipelineExecutionId: execution.id,
            label: "VIN",
            name: v,
            verificationStatus: "verified",
            createdBy: "system"
        }).returning();
        createdNodes.push(newNode);
    }

    // 4. Create Edges
    // T1 -> V1, T2 -> V2, T3 -> V3
    for (let i = 0; i < 3; i++) {
        await db.insert(knowledgeEdges).values({
            organizationId: TARGET_ORG_ID,
            sourceId: createdNodes[i].id, // Ticket
            targetId: createdNodes[i + 3].id, // VIN
            relation: "RELATES_TO",
            weight: 1,
            lastUpdatedByRunId: execution.id,
            createdBy: "system"
        });
    }

    console.log("✅ Data Generation Complete.");
    console.log(`Run Context: Run #${execution.id}`);
    process.exit(0);
}

main().catch(console.error);
