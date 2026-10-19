
import "dotenv/config";
import { systemKnowledgeService } from "../server/domain/knowledge/index";

async function main() {
    console.log("🚀 Starting System Knowledge Graph Sync...");
    try {
        await systemKnowledgeService.ingestSystemMemory();
        console.log("✅ Sync Complete!");
    } catch (err) {
        console.error("❌ Sync Failed:", err);
        process.exit(1);
    }
}

main();
