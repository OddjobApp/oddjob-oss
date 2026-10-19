
import { getClient, QDRANT_COLLECTION } from "../../server/integrations/qdrant-client";

async function run() {
    const client = getClient();
    try {
        const response = await client.scroll(QDRANT_COLLECTION, {
            limit: 5,
            with_payload: true
        });
        console.log("Points peek:", JSON.stringify(response.points, null, 2));
        process.exit(0);
    } catch (error: any) {
        console.error("Failed to scroll points:", error.message);
        process.exit(1);
    }
}

run();
