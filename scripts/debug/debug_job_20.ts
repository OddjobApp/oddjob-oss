import { db } from "@server/db/index.js";
import { jobs, knowledgeTopics, knowledgeTopicDocuments } from '@shared/schema/index.js';
import { eq } from 'drizzle-orm';

async function main() {
    console.log("Checking Job 20 Config...");
    const job = await db.query.jobs.findFirst({
        where: eq(jobs.id, 20)
    });
    console.log(JSON.stringify(job?.config, null, 2));

    console.log("\nChecking 'billing' topic...");
    const topics = await db.select().from(knowledgeTopics);
    const billingTopic = topics.find((t: any) => t.name.toLowerCase().includes('billing'));

    if (billingTopic) {
        console.log("Billing Topic Found:", billingTopic);
        const docs = await db.select().from(knowledgeTopicDocuments).where(eq(knowledgeTopicDocuments.topicId, billingTopic.id));
        console.log(`Topic has ${docs.length} documents assigned.`);
    } else {
        console.log("Billing topic NOT found.");
    }

    process.exit(0);
}

main().catch(console.error);
