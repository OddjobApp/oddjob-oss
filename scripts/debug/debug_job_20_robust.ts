
// Minimal DB check with CORRECT PORT
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '@shared/schema/index.js';
import { eq } from 'drizzle-orm';

const { Pool } = pg;
const pool = new Pool({
    connectionString: "postgres://postgres:postgres@localhost:5433/oddjob",
});
const db = drizzle(pool, { schema });

async function main() {
    console.log("Checking Job 20 Config...");
    const job = await db.query.jobs.findFirst({
        where: eq(schema.jobs.id, 20)
    });
    console.log(JSON.stringify(job?.config, null, 2));

    console.log("\nChecking 'billing' topic...");
    const topics = await db.select().from(schema.knowledgeTopics);
    const billingTopic = topics.find((t: any) => t.name.toLowerCase().includes('billing'));

    if (billingTopic) {
        console.log("Billing Topic Found:", billingTopic);
        const docs = await db.select().from(schema.knowledgeTopicDocuments).where(eq(schema.knowledgeTopicDocuments.topicId, billingTopic.id));
        console.log(`Topic has ${docs.length} documents assigned.`);
    } else {
        console.log("Billing topic NOT found.");
    }

    process.exit(0);
}

main().catch(console.error);
