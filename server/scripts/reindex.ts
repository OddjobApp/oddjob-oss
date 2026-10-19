import "dotenv/config";
import { fullReindex } from "@domain/xray/core/xray-indexing.service.js";

async function run() {
    console.log("Triggering full reindex for org 1...");
    const result = await fullReindex(1);
    console.log("Reindex complete:", result);
    process.exit(0);
}

run().catch(console.error);
