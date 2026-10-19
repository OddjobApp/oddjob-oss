
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
            limit: 10,
            with_payload: true
        });

        console.log(`Points found: ${response.points.length}`);
        if (response.points.length > 0) {
            console.log("Sample points:", JSON.stringify(response.points, null, 2));
        } else {
            console.log("No points found for Org 2.");

            console.log("Checking all points to see what orgs exist...");
            const allPoints = await client.scroll(QDRANT_COLLECTION, {
                limit: 10,
                with_payload: true
            });
            console.log(`Total points in collection (top 10): ${allPoints.points.length}`);
            const orgs = [...new Set(allPoints.points.map((p: any) => p.payload?.organizationId))];
            console.log("Organizations found in sample points:", orgs);
        }

    } catch (e) {
        console.error("Error:", e);
    }
}

run();
