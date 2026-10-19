
import "dotenv/config";
import { db } from "@server/database_service.js";
import { knowledgeDocumentExtractions, knowledgeDocuments } from "@shared/schema/index.js";
import { eq, desc } from "drizzle-orm";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { Queue } from "bullmq";

async function run() {
    console.log("=== Debugging Ingestion ===");

    // 1. Check Redis
    try {
        const ping = await redis.ping();
        console.log("Redis Ping:", ping);
    } catch (e: any) {
        console.error("Redis Connection Failed:", e.message);
    }

    // 2. Check BullMQ Queue
    const QUEUE_NAME = 'knowledge-extractions';
    const queue = new Queue(QUEUE_NAME, { connection: redis as any });

    const waiting = await queue.getWaitingCount();
    const active = await queue.getActiveCount();
    const completed = await queue.getCompletedCount();
    const failedCount = await queue.getFailedCount();
    const delayed = await queue.getDelayedCount();

    console.log(`\nBullMQ Queue Status (${QUEUE_NAME}):`);
    console.log(`- Waiting: ${waiting}`);
    console.log(`- Active: ${active}`);
    console.log(`- Completed: ${completed}`);
    console.log(`- Failed: ${failedCount}`);
    console.log(`- Delayed: ${delayed}`);

    const failed = await queue.getFailed(0, 100);
    if (failed.length > 0) {
        console.log(`\nFailed Jobs in BullMQ:`);
        failed.forEach(f => {
            console.log(`- JobID: ${f.id} | Reason: ${f.failedReason}`);
        });
    }

    // 3. Check Extractions in DB
    const extractions = await db.select()
        .from(knowledgeDocumentExtractions)
        .orderBy(desc(knowledgeDocumentExtractions.queuedAt))
        .limit(10);

    console.log(`\nLast 10 Extractions in DB:`);
    for (const ex of extractions) {
        const [doc] = await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, ex.documentId)).limit(1);
        console.log(`- ID: ${ex.id} | Status: ${ex.status} | Doc: ${doc?.title} (${ex.documentId}) | JobID: ${ex.bullmqJobId} | Progress: ${ex.progress}%`);
        if (ex.error) {
            console.log(`  Error: ${ex.error}`);
        }
    }

    process.exit(0);
}

run().catch((e: any) => {
    console.error(e);
    process.exit(1);
});
