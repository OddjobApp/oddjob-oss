
import { db } from "../server/db/index.js";
import { evaluationTestSets, evaluationTestCases, orgs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function seedEvaluationData() {
    console.log("Seeding Evaluation Studio examples...");

    // Get the first org to assign to
    const [org] = await db.select().from(orgs).limit(1);
    if (!org) {
        console.error("No organization found to seed data for.");
        return;
    }

    // 1. Core Agent Capabilities Test Set
    const [set1] = await db.insert(evaluationTestSets).values({
        organizationId: org.id,
        name: "Core Agent Capabilities",
        description: "Standard tests for general agent performance and reasoning.",
    }).returning();

    await db.insert(evaluationTestCases).values([
        {
            testSetId: set1.id,
            inputPrompt: "What are the common severity levels for bug reports in our system?",
            expectedCriteria: "Critical, High, Medium, Low",
            method: "keyword",
        },
        {
            testSetId: set1.id,
            inputPrompt: "How do I create a new Form Agent?",
            expectedCriteria: "Navigate to Document Templates and click 'Create Form Agent'.",
            method: "llm_judge",
        },
        {
            testSetId: set1.id,
            inputPrompt: "Is the knowledge graph enabled by default for new organizations?",
            expectedCriteria: "Yes|No", // Actually need to check docs
            method: "llm_judge",
        }
    ]);

    // 2. Knowledge Graph Accuracy Test Set
    const [set2] = await db.insert(evaluationTestSets).values({
        organizationId: org.id,
        name: "Knowledge Graph Extraction",
        description: "Tests for explicit and semantic KG extraction rules.",
    }).returning();

    await db.insert(evaluationTestCases).values([
        {
            testSetId: set2.id,
            inputPrompt: "Extract ticket TICKET-001 with title 'Login page crashes' from this JSON: { \"tickets\": [{\"id\": \"TICKET-001\", \"title\": \"Login page crashes\"}] }",
            expectedCriteria: "TICKET-001",
            method: "keyword",
        },
        {
            testSetId: set2.id,
            inputPrompt: "What relation is used between Tickets and Features?",
            expectedCriteria: "relates_to",
            method: "keyword",
        }
    ]);

    console.log("Seeding complete!");
    process.exit(0);
}

seedEvaluationData().catch(console.error);
