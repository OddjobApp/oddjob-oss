
import { QdrantClient } from "@qdrant/js-client-rest";
import 'dotenv/config';

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || "";
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || "oddjob_rag_assets";

async function run() {
    const client = new QdrantClient({
        url: QDRANT_URL,
        apiKey: QDRANT_API_KEY || undefined,
    });

    try {
        const orgId = 2; // TechStart Inc
        console.log(`Checking Qdrant points for Org ${orgId}...`);

        const response = await client.scroll(QDRANT_COLLECTION, {
            filter: {
                must: [
                    {
                        key: "organizationId",
                        match: { value: orgId }
                    }
                ]
            },
            limit: 1,
            with_payload: true
        });

        if (response.points.length > 0) {
            console.log("Found point for Org 2. Payload:");
            console.log(JSON.stringify(response.points[0].payload, null, 2));
        } else {
            console.log("No points found for Org 2 with current filter.");
        }

    } catch (e) {
        console.error("Error:", e);
    }
}

run();
