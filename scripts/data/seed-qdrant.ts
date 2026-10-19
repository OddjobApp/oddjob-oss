import "dotenv/config";
import { db } from "../../server/db/index.js";
import { knowledgeDocuments } from "@shared/schema";
import { reindexKnowledgeDocument } from "../../server/knowledge/knowledge-store";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PARALLEL_DOCS = 2; // Number of documents to process in parallel
const START_INDEX = parseInt(process.env.START_INDEX || "0", 10);

async function main() {
  if (!GEMINI_API_KEY) {
    console.error("❌ GEMINI_API_KEY missing. Cannot proceed with enrichment.");
    process.exit(1);
  }

  const allDocs = await db.select().from(knowledgeDocuments);
  const docs = allDocs.slice(START_INDEX);

  console.log(`🚀 Starting re-indexing for ${docs.length} documents (from index ${START_INDEX}/${allDocs.length})...`);
  console.log(`⚙️  Configuration: PARALLEL_DOCS=${PARALLEL_DOCS}, CHUNK_CONCURRENCY=10`);

  let processedCount = 0;
  let errorCount = 0;

  // Process in batches of PARALLEL_DOCS
  for (let i = 0; i < docs.length; i += PARALLEL_DOCS) {
    const batch = docs.slice(i, i + PARALLEL_DOCS);

    await Promise.all(batch.map(async (doc) => {
      const currentIndex = START_INDEX + i + batch.indexOf(doc);
      try {
        console.log(`[${currentIndex + 1}/${allDocs.length}] Re-indexing: ${doc.title.substring(0, 40)}...`);
        await reindexKnowledgeDocument(doc as any);
        processedCount++;
      } catch (error: any) {
        errorCount++;
        console.error(`\n❌ Failed to reindex document ${doc.id} (${doc.title}):`, error.message);
      }
    }));
  }

  console.log(`\n\n✨ Re-indexing complete!`);
  console.log(`- Total Processed: ${processedCount}`);
  console.log(`- Total Failed: ${errorCount}`);
  console.log(`- Last Index: ${START_INDEX + docs.length - 1}`);

  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error during re-indexing:", error);
  process.exit(1);
});
