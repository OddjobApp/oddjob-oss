
import "dotenv/config";
import { db } from "../../server/db/index.js";
import { knowledgeNodes, knowledgeEdges, orgs, jobs } from "@shared/schema";

async function generateData() {
    console.log("🕸 Generating Knowledge Graph data...");

    // 1. Get Organization
    const [org] = await db.select().from(orgs).limit(1);
    if (!org) {
        console.error("No organization found. Please run seed first.");
        process.exit(1);
    }
    const orgId = org.id;

    // 2. Clear existing
    await db.delete(knowledgeEdges);
    await db.delete(knowledgeNodes);

    // 3. Create Nodes
    console.log("Creating nodes...");

    const [john] = await db.insert(knowledgeNodes).values({
        label: "User",
        name: "John Doe",
        externalId: "user-101",
        data: { role: "DevOps Engineer", email: "john@acme.com" },
        organizationId: orgId,
    }).returning();

    const [paymentService] = await db.insert(knowledgeNodes).values({
        label: "Infrastructure",
        name: "Payment Gateway Service",
        externalId: "svc-payment",
        data: { tier: "critical", language: "Go" },
        organizationId: orgId,
    }).returning();

    const [incident] = await db.insert(knowledgeNodes).values({
        label: "Incident",
        name: "High Latency in Payments",
        externalId: "INC-999",
        data: { status: "active", severity: "P1" },
        organizationId: orgId,
    }).returning();

    const [ticket] = await db.insert(knowledgeNodes).values({
        label: "Ticket",
        name: "Investigate DB connection pool",
        externalId: "TICK-123",
        data: { status: "in_progress", priority: "high" },
        organizationId: orgId,
    }).returning();

    const [primaryDb] = await db.insert(knowledgeNodes).values({
        label: "Infrastructure",
        name: "Primary Payments DB",
        externalId: "db-pay-01",
        data: { type: "PostgreSQL", version: "15.4", zone: "us-east-1a" },
        organizationId: orgId,
    }).returning();

    const [badDeployment] = await db.insert(knowledgeNodes).values({
        label: "Deployment",
        name: "Release v2.4.5",
        externalId: "deploy-88219",
        data: { status: "failed", deployedBy: "ci-bot", timestamp: new Date().toISOString() },
        organizationId: orgId,
    }).returning();

    const [slackChannel] = await db.insert(knowledgeNodes).values({
        label: "SlackChannel",
        name: "#incident-payments-latency",
        externalId: "C012345678",
        data: { members: 45, topic: "War room for INC-999" },
        organizationId: orgId,
    }).returning();

    const [runbook] = await db.insert(knowledgeNodes).values({
        label: "KnowledgeDocument",
        name: "DB Connection Pool Tuning Guide",
        externalId: "wiki-552",
        data: { url: "https://wiki.acme.com/db/tuning", lastUpdated: "2024-03-15" },
        organizationId: orgId,
    }).returning();

    // 5. Create a Job with Schema (Simulating "Usage of stored job schemas")
    console.log("Creating job with schema...");
    const jobInsertResult = await db.insert(jobs).values({
        name: "Fetch Recent JIRA Tickets",
        type: "api",
        tool: "None",
        config: { url: "https://jira.acme.com/api/search", method: "GET" },
        priority: 2,
        isActive: true,
        createdBy: "admin",
        // This is the "existing stored job schema" the user asked about
        outputSchema: {
            capturedAt: new Date().toISOString(),
            sampleOutput: {
                issues: [
                    { key: "TICK-202", summary: "Slow queries", priority: "High" }
                ]
            },
            schemaDef: {
                "issues": { type: "array" },
                "issues.key": { type: "string", isKey: true },
                "issues.summary": { type: "string" },
                "issues.priority": { type: "string" }
            },
            suggestedLabel: "Ticket"
        }
    }).returning();
    const jiraJob = jobInsertResult[0];

    // 6. Create Discovered Tickets (as if found by the job)
    const [ticket2] = await db.insert(knowledgeNodes).values({
        label: "Ticket",
        name: "Slow queries in payment reporting",
        externalId: "TICK-202",
        data: { status: "open", priority: "medium", sourceJobId: jiraJob.id },
        organizationId: orgId,
    }).returning();

    const [ticket3] = await db.insert(knowledgeNodes).values({
        label: "Ticket",
        name: "Timeout in checkout API",
        externalId: "TICK-404",
        data: { status: "investigating", priority: "critical", sourceJobId: jiraJob.id },
        organizationId: orgId,
    }).returning();


    // 4. Create Edges
    console.log("Creating edges...");

    await db.insert(knowledgeEdges).values([
        {
            sourceId: john.id,
            targetId: paymentService.id,
            relation: "MAINTAINS",
            weight: 5,
            organizationId: orgId,
        },
        {
            sourceId: incident.id,
            targetId: paymentService.id,
            relation: "AFFECTS",
            weight: 10,
            organizationId: orgId,
        },
        {
            sourceId: ticket.id,
            targetId: incident.id,
            relation: "RELATED_TO",
            weight: 8,
            organizationId: orgId,
        },
        {
            sourceId: john.id,
            targetId: ticket.id,
            relation: "ASSIGNED_TO",
            weight: 10,
            organizationId: orgId,
        },
        {
            sourceId: paymentService.id,
            targetId: primaryDb.id,
            relation: "DEPENDS_ON",
            weight: 9,
            organizationId: orgId,
        },
        {
            sourceId: incident.id,
            targetId: badDeployment.id,
            relation: "CAUSED_BY",
            weight: 10,
            organizationId: orgId,
        },
        {
            sourceId: incident.id,
            targetId: slackChannel.id,
            relation: "DISCUSSED_IN",
            weight: 5,
            organizationId: orgId,
        },
        {
            sourceId: ticket.id,
            targetId: runbook.id,
            relation: "REFERENCES",
            weight: 3,
            organizationId: orgId,
        },
        // Discovery Linkages
        {
            sourceId: ticket2.id,
            targetId: paymentService.id,
            relation: "REFERENCES", // Found by scanning service logs/tickets
            weight: 7,
            organizationId: orgId,
        },
        {
            sourceId: ticket3.id,
            targetId: paymentService.id,
            relation: "AFFECTS",
            weight: 9,
            organizationId: orgId,
        },
        {
            sourceId: ticket3.id,
            targetId: incident.id,
            relation: "RELATED_TO",
            weight: 6,
            organizationId: orgId,
        }
    ]);

    console.log("✅ Successfully generated Knowledge Graph data.");
    process.exit(0);
}

generateData().catch((err) => {
    console.error("❌ Generation failed:", err);
    process.exit(1);
});
