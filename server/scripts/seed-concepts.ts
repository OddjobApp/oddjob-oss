import 'dotenv/config';
import { db } from "../database_service.js";
import { knowledgeConcepts, knowledgeTopicConcepts, knowledgeTopics } from "@shared/schema/index.js";
import { eq, and, sql, ilike } from "drizzle-orm";

async function main() {
    console.log("Seeding Manual Concepts and Links...");
    const orgId = 1;

    const conceptSeeds = [
        { name: "Infrastructure & Cloud", description: "Cloud resources, database infrastructure, and environment settings." },
        { name: "Security & Governance", description: "Authentication, policies, and system security configurations." },
        { name: "Deployment & Delivery", description: "CI/CD pipelines, release management, and environment deployments." },
        { name: "Errors & Diagnostics", description: "System errors, logs, and troubleshooting information." },
        { name: "Application Architecture", description: "Backend logic, frontend structure, and service definitions." }
    ];

    for (const seed of conceptSeeds) {
        let [concept] = await db.select().from(knowledgeConcepts).where(
            and(
                eq(knowledgeConcepts.organizationId, orgId),
                ilike(knowledgeConcepts.name, seed.name)
            )
        ).limit(1);

        if (!concept) {
            [concept] = await db.insert(knowledgeConcepts).values({
                ...seed,
                organizationId: orgId,
                createdAt: new Date(),
                updatedAt: new Date()
            }).returning();
            console.log(`Created Concept: ${concept.name}`);
        } else {
            console.log(`Concept Exists: ${concept.name}`);
        }

        // Link some matching topics
        const topics = await db.select().from(knowledgeTopics).where(eq(knowledgeTopics.organizationId, orgId));

        let targetKeywords: string[] = [];
        if (seed.name.includes("Infrastructure")) targetKeywords = ["db", "database", "cloud", "aws", "rds", "postgres"];
        if (seed.name.includes("Security")) targetKeywords = ["auth", "security", "permission", "admin"];
        if (seed.name.includes("Deployment")) targetKeywords = ["release", "deploy", "stg", "prd", "environment"];
        if (seed.name.includes("Errors")) targetKeywords = ["error", "fail", "failed", "crash", "issue"];
        if (seed.name.includes("Application")) targetKeywords = ["service", "logic", "api", "route", "backend"];

        for (const topic of topics) {
            const normalizedName = topic.name.toLowerCase();
            if (targetKeywords.some(kw => normalizedName.includes(kw))) {
                const [existing] = await db.select().from(knowledgeTopicConcepts).where(
                    and(
                        eq(knowledgeTopicConcepts.topicId, topic.id),
                        eq(knowledgeTopicConcepts.conceptId, concept.id)
                    )
                ).limit(1);

                if (!existing) {
                    await db.insert(knowledgeTopicConcepts).values({
                        topicId: topic.id,
                        conceptId: concept.id,
                        createdAt: new Date()
                    });
                    console.log(`Linked Topic [${topic.name}] -> Concept [${concept.name}]`);
                }
            }
        }
    }

    console.log("Seeding Complete.");
    process.exit(0);
}

main().catch(console.error);

