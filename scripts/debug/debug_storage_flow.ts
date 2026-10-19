
import 'dotenv/config';
import { db } from "../../server/database_service.js";
import { jobs } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";
import { storeJobOutputAsKnowledge, getJobOutputStorageConfig } from "@domain/knowledge/core/knowledge-store.js";
import { createHash } from "crypto";

async function main() {
    console.log("=== Debugging Knowledge Storage Flow ===");

    // 1. Load Job 20
    const [job] = await db.select().from(jobs).where(eq(jobs.id, 20)).limit(1);
    if (!job) { console.log("Job 20 not found"); return; }

    console.log("Job loaded.");
    console.log("QDRANT_URL:", process.env.QDRANT_URL);

    const output = JSON.stringify({ issues: [{ key: "TEST-1-FIXED" }] });
    const settings = getJobOutputStorageConfig(job);

    console.log("Calling storeJobOutputAsKnowledge...");
    try {
        await storeJobOutputAsKnowledge({
            output: output,
            job: job,
            stepExecution: {
                id: 3, // Real step execution ID from Pipeline 8 (Run #3)
                status: "success",
                executedAt: new Date()
            },
            topicId: job.outputKnowledgeTopicId, // Should be 1
            tags: job.outputTags || [],
            settings: settings
        });
        console.log("Success! Data stored.");
    } catch (e: any) {
        console.error("Storage FAILED:");
        console.error(e);
    }

    process.exit(0);
}

main();
