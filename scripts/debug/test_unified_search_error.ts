
import { retrieveSimilarDocuments } from "@domain/knowledge/core/rag-langchain.service.js";

async function run() {
    const query = "duplicate subscriptions Zuora";
    console.log(`Testing search for: "${query}"`);

    try {
        const results = await retrieveSimilarDocuments(query, {
            k: 5,
            organizationId: 3,
            recencyBias: 0.1,
            authorityBias: 0.2
        });
        console.log(`Results found: ${results.length}`);
        if (results.length > 0) {
            console.log("First result preview:", results[0].pageContent.substring(0, 100));
        }
        process.exit(0);
    } catch (error: any) {
        console.error("Search failed with error:", error.message);
        if (error.stack) console.error(error.stack);
        process.exit(1);
    }
}

run();
