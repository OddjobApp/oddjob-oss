import { db } from "@server/db/index.js";
import { knowledgeTopics } from '@shared/schema/index.js';

async function main() {
    const topics = await db.select().from(knowledgeTopics);
    console.log('Topics:', JSON.stringify(topics, null, 2));
    process.exit(0);
}

main().catch(console.error);
