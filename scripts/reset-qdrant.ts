
import { QdrantClient } from "@qdrant/js-client-rest";

const QDRANT_URL = process.env.QDRANT_URL || "http://127.0.0.1:6333";
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || "oddjob_rag_assets";
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || "dev-key";
const VECTOR_SIZE = parseInt(process.env.QDRANT_VECTOR_SIZE || "768", 10);

async function reset() {
    const client = new QdrantClient({
        url: QDRANT_URL,
        apiKey: QDRANT_API_KEY,
        checkCompatibility: false
    });

    try {
        console.log(`Deleting collection: ${QDRANT_COLLECTION}...`);
        try {
            await client.deleteCollection(QDRANT_COLLECTION);
        } catch (e) {
            console.log("Collection might not exist, skipping delete.");
        }

        console.log(`Creating collection: ${QDRANT_COLLECTION} with size ${VECTOR_SIZE}...`);
        await client.createCollection(QDRANT_COLLECTION, {
            vectors: {
                size: VECTOR_SIZE,
                distance: "Cosine"
            }
        });
        console.log("SUCCESS: Collection reset.");
    } catch (e: any) {
        console.error("FAILED to reset collection:", e.message);
    }
}

reset();
