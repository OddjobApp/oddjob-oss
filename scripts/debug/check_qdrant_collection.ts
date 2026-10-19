
import { getClient, QDRANT_COLLECTION } from "../../server/integrations/qdrant-client";

async function run() {
    const client = getClient();
    try {
        const info = await client.getCollection(QDRANT_COLLECTION);
        console.log("Collection Info:", JSON.stringify(info, null, 2));
        process.exit(0);
    } catch (error: any) {
        console.error("Failed to get collection info:", error.message);
        process.exit(1);
    }
}

run();
