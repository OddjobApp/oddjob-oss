
import { QdrantClient } from "@qdrant/js-client-rest";

async function countQdrantPoints() {
    const client = new QdrantClient({
        url: process.env.QDRANT_URL || "http://127.0.0.1:6333",
        apiKey: process.env.QDRANT_API_KEY,
    });

    const collectionName = "oddjob_knowledge_v1";
    try {
        const info = await client.getCollection(collectionName);
        console.log(`Collection "${collectionName}" has ${info.points_count} points.`);
    } catch (err) {
        console.error("Failed to get Qdrant count:", err);
    }
    process.exit(0);
}

countQdrantPoints();
