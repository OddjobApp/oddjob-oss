import { Queue } from 'bullmq';
import "dotenv/config";
import { db } from "../server/db/index.js";
import { knowledgeDocumentExtractions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { queueExtractionJob } from "../server/domain/knowledge/index";

const redisOptions = process.env.REDIS_URL || {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
};

const QUEUE_NAME = 'knowledge-extractions';

async function main() {
    console.log(`Clearing queue: ${QUEUE_NAME}`);
    const queue = new Queue(QUEUE_NAME, {
        connection: redisOptions as any,
    });

    try {
        await queue.obliterate({ force: true });
        console.log("✅ Queue cleared.");

        const stalled = await db.select().from(knowledgeDocumentExtractions)
            .where(eq(knowledgeDocumentExtractions.status, "queued"));

        console.log(`Re-queuing ${stalled.length} records...`);

        for (const record of stalled) {
            console.log(`Re-queuing extraction ${record.id} (Doc ${record.documentId})...`);
            await queueExtractionJob({
                type: 'document',
                extractionId: record.id,
                documentId: record.documentId,
                schemaId: record.schemaId,
                organizationId: record.organizationId
            });
            console.log(` ✅ Done.`);
        }

    } catch (err) {
        console.error("Failed to clear/re-queue:", err);
    } finally {
        await queue.close();
    }
    process.exit(0);
}

main().catch(console.error);
