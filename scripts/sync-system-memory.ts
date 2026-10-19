
import { systemKnowledgeService } from "../server/domain/knowledge/core/system-knowledge-service.js";
import { db } from "../server/db/index.js";

async function sync() {
    console.log("Starting System Memory Sync...");
    try {
        // This will clear and re-ingest everything, including indexing in Qdrant
        await systemKnowledgeService.ingestSystemMemory();
        console.log("SUCCESS: System Memory Sync complete.");

        // Wait a bit for async indexing to finish (it's triggered for each node)
        console.log("Waiting for async indexing to stabilize...");
        await new Promise(resolve => setTimeout(resolve, 10000));

        process.exit(0);
    } catch (e: any) {
        console.error("FAILED to sync system memory:", e);
        process.exit(1);
    }
}

sync();
