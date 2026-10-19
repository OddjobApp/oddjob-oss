
import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from "dotenv";
dotenv.config();

async function sampleQdrantPoints() {
    const client = new QdrantClient({
        url: process.env.QDRANT_URL || "http://127.0.0.1:6333",
        apiKey: process.env.QDRANT_API_KEY || "dev-key",
    });

    const collectionName = process.env.QDRANT_COLLECTION || "oddjob_rag_assets";
    console.log(`Sampling points from: "${collectionName}"...`);
    try {
        const points = await client.scroll(collectionName, { limit: 10, with_payload: true });
        console.log(`Found ${points.points.length} points.`);
        points.points.forEach((p, i) => {
            console.log(`\nPoint ${i}: ${p.id}`);
            console.log(`Payload: ${JSON.stringify(p.payload, null, 2)}`);
        });
    } catch (err) {
        console.error("Failed to sample Qdrant points:", err);
    }
    process.exit(0);
}

sampleQdrantPoints();
