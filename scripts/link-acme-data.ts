
import 'dotenv/config';
import { db } from "../server/db/index.js";
import { orgs, knowledgeNodes, knowledgeEdges } from "../shared/schema/index";
import { ilike, eq, and, sql } from "drizzle-orm";

async function main() {
    const acmeId = 1; // Correct ID for Acme
    console.log(`Using Acme organization ID: ${acmeId}`);

    console.log("Fetching existing knowledge nodes for acme...");
    const nodes = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.organizationId, acmeId));

    console.log(`Found ${nodes.length} nodes.`);

    const jiraIssues = nodes.filter(n => n.label === 'Jira Issue' || n.label === 'JiraIssue' || n.label === 'Ticket');
    const confluencePages = nodes.filter(n => n.label === 'Confluence Page' || n.label === 'ConfluencePage' || n.label === 'Document');
    const requirements = nodes.filter(n => n.label === 'Requirement' || n.label === 'Feature');
    const concepts = nodes.filter(n => n.label === 'Concept' || n.label === 'Topic');

    console.log(`Stats: ${jiraIssues.length} Jira, ${confluencePages.length} Confluence, ${requirements.length} Requirements, ${concepts.length} Concepts.`);

    if (jiraIssues.length === 0 && requirements.length === 0) {
        console.log("Warning: No Jira Issues or Requirements found. Checking unique labels...");
        const labels = Array.from(new Set(nodes.map(n => n.label)));
        console.log("Labels found:", labels);
    }

    console.log("Creating relationships...");
    const edgesToInsert = [];

    // Create a mesh
    for (let i = 0; i < Math.min(jiraIssues.length, requirements.length); i++) {
        edgesToInsert.push({
            sourceId: jiraIssues[i].id,
            targetId: requirements[i].id,
            relation: "RELATED_TO",
            weight: 8,
            organizationId: acmeId
        });
    }

    for (let i = 0; i < Math.min(requirements.length, concepts.length); i++) {
        edgesToInsert.push({
            sourceId: requirements[i].id,
            targetId: concepts[i].id,
            relation: "ABOUT",
            weight: 9,
            organizationId: acmeId
        });
    }

    for (let i = 0; i < Math.min(confluencePages.length, concepts.length); i++) {
        edgesToInsert.push({
            sourceId: confluencePages[i].id,
            targetId: concepts[i].id,
            relation: "ABOUT",
            weight: 8,
            organizationId: acmeId
        });
    }

    if (edgesToInsert.length > 0) {
        const chunkSize = 100;
        for (let i = 0; i < edgesToInsert.length; i += chunkSize) {
            const chunk = edgesToInsert.slice(i, i + chunkSize);
            await db.insert(knowledgeEdges).values(chunk).onConflictDoNothing();
        }
        console.log(`Created ${edgesToInsert.length} relationships for Acme (ID 1).`);
    }

    process.exit(0);
}

main().catch(console.error);
