
import 'dotenv/config';
import { db } from "../server/db/index.js";
import { knowledgeNodes, knowledgeEdges } from "../shared/schema/index";

async function main() {
    console.log("Seeding Knowledge Graph visualization data...");

    // 1. Create Nodes
    const [reqNode] = await db.insert(knowledgeNodes).values({
        label: "Requirement",
        name: "User Authentication",
        data: { priority: "High", status: "In Analysis" },
        organizationId: 1
    }).returning();

    const [conceptNode] = await db.insert(knowledgeNodes).values({
        label: "Concept",
        name: "OIDC Flow",
        data: { description: "Standard authentication protocol" },
        organizationId: 1
    }).returning();

    const [jiraNode] = await db.insert(knowledgeNodes).values({
        label: "JiraIssue",
        name: "Implement Login Page",
        externalId: "PROJ-123",
        data: { status: "To Do", assignee: "Developer A" },
        organizationId: 1
    }).returning();

    const [confNode] = await db.insert(knowledgeNodes).values({
        label: "ConfluencePage",
        name: "Security Architecture",
        externalId: "CONF-456",
        data: { space: "Engineering", views: 152 },
        organizationId: 1
    }).returning();

    console.log("Nodes created. Linking them...");

    // 2. Create Edges
    await db.insert(knowledgeEdges).values([
        {
            sourceId: jiraNode.id,
            targetId: confNode.id,
            relation: "MENTIONS",
            weight: 5,
            organizationId: 1
        },
        {
            sourceId: jiraNode.id,
            targetId: reqNode.id,
            relation: "RELATED_TO",
            weight: 8,
            organizationId: 1
        },
        {
            sourceId: reqNode.id,
            targetId: conceptNode.id,
            relation: "ABOUT",
            weight: 10,
            organizationId: 1
        },
        {
            sourceId: confNode.id,
            targetId: conceptNode.id,
            relation: "ABOUT",
            weight: 9,
            organizationId: 1
        }
    ]);

    console.log("Knowledge Graph visualization data seeded successfully.");
    process.exit(0);
}

main().catch(console.error);
