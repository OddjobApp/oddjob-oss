import "dotenv/config";
import { db } from "../database_service.js";
import { 
    errorDiagnoses, 
    errorEmbeddings, 
    errorClusters, 
    errorAlerts, 
    forensicEventLog 
} from "@shared/schema/index.js";
import { sql } from "drizzle-orm";

async function main() {
    console.log("--- CLEARING SYSTEM INCIDENTS ---");

    try {
        // 1. Clear Error Embeddings (References Diagnoses)
        console.log("Clearing error_embeddings...");
        await db.delete(errorEmbeddings);

        // 2. Clear Error Diagnoses
        console.log("Clearing error_diagnoses...");
        await db.delete(errorDiagnoses);

        // 3. Clear Error Alerts (References Alert Configs, but we only clear the alerts)
        console.log("Clearing error_alerts...");
        await db.delete(errorAlerts);

        // 4. Clear Error Clusters
        console.log("Clearing error_clusters...");
        await db.delete(errorClusters);

        // 5. Clear Forensic Event Log
        // Note: This resets Sentinel health metrics as they depend on this log.
        console.log("Clearing forensic_event_log...");
        await db.delete(forensicEventLog);

        console.log("\nSuccess: All existing incidents and forensic logs have been cleared.");
        console.log("Oddjob diagnostic engine is now in a fresh state.");

    } catch (error) {
        console.error("\nError clearing incidents:", error);
        process.exit(1);
    }
}

main().then(() => process.exit(0));
