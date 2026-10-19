import dotenv from "dotenv";
import path from "path";

// Ensure environment variables are loaded first
dotenv.config({ path: path.join(process.cwd(), ".env") });

async function main() {
    console.log("Clearing semantic cache...");
    const { clearQdrantCollection } = await import("../integrations/qdrant-client.js");
    
    await clearQdrantCollection("llm_semantic_cache");
    console.log("Semantic cache collection 'llm_semantic_cache' cleared successfully.");
    process.exit(0);
}

main().catch(err => {
    console.error("Failed to clear cache:", err);
    process.exit(1);
});
