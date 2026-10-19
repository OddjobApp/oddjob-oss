import "dotenv/config";
import { db } from "../../server/db/index.js";
import { knowledgeTopics, knowledgeDocuments, knowledgeTopicDocuments } from "@shared/schema";
import { eq } from "drizzle-orm";

async function main() {
    console.log("Seeding Topics...");

    const topicsToCreate = [
        { name: "Engineering", description: "Engineering related documents" },
        { name: "HR", description: "Human Resources policies" },
        { name: "Sales", description: "Sales playbooks and assets" },
        { name: "Marketing", description: "Brand guidelines and assets" },
    ];

    const createdTopics = [];

    for (const t of topicsToCreate) {
        // Check if exists
        const exists = await db.select().from(knowledgeTopics).where(eq(knowledgeTopics.name, t.name));
        if (exists.length > 0) {
            console.log(`Topic ${t.name} already exists.`);
            createdTopics.push(exists[0]);
            continue;
        }

        const [topic] = await db.insert(knowledgeTopics).values(t).returning();
        console.log(`Created topic: ${topic.name} (${topic.id})`);
        createdTopics.push(topic);
    }

    // Create sub-topic
    const hrTopic = createdTopics.find(t => t.name === "HR");
    if (hrTopic) {
        const subTopicName = "Onboarding";
        const exists = await db.select().from(knowledgeTopics).where(eq(knowledgeTopics.name, subTopicName));
        let subTopic;
        if (exists.length > 0) {
            subTopic = exists[0];
        } else {
            [subTopic] = await db.insert(knowledgeTopics).values({
                name: subTopicName,
                description: "New hire onboarding",
                parentTopicId: hrTopic.id
            }).returning();
            console.log(`Created sub-topic: ${subTopic.name} (${subTopic.id})`);
        }
        createdTopics.push(subTopic);

        // Create a document
        const docTitle = "Employee Handbook 2024";
        const docExists = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.title, docTitle));
        let doc;
        if (docExists.length > 0) {
            doc = docExists[0];
        } else {
            [doc] = await db.insert(knowledgeDocuments).values({
                title: docTitle,
                summary: "The official employee handbook.",
                sourceType: "text",
                textContent: "Welcome to the company! Here are the rules..."
            }).returning();
            console.log(`Created document: ${doc.title} (${doc.id})`);
        }

        // Link doc to HR and Onboarding
        // Check if linked
        const existingLinks = await db.select().from(knowledgeTopicDocuments).where(eq(knowledgeTopicDocuments.documentId, doc.id));
        const linkedTopicIds = existingLinks.map(l => l.topicId);

        if (!linkedTopicIds.includes(hrTopic.id)) {
            await db.insert(knowledgeTopicDocuments).values({
                topicId: hrTopic.id,
                documentId: doc.id
            });
            console.log(`Linked document to ${hrTopic.name}`);
        }

        if (!linkedTopicIds.includes(subTopic.id)) {
            await db.insert(knowledgeTopicDocuments).values({
                topicId: subTopic.id,
                documentId: doc.id
            });
            console.log(`Linked document to ${subTopic.name}`);
        }
    }

    console.log("Done.");
    process.exit(0);
}

main().catch(console.error);
