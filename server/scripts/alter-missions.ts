import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function main() {
    console.log("Adding missing columns...");
    await db.execute(sql`ALTER TABLE missions ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES missions(id) ON DELETE SET NULL;`);
    
    // Add missing knowledge_nodes columns
    const knCols = [
        "verification_status text DEFAULT 'staging'",
        "confidence_score decimal(3,2)",
        "initial_confidence_score decimal(3,2)",
        "verified_by text",
        "verified_at timestamp",
        "last_reaffirmed_at timestamp",
        "usage_count integer DEFAULT 0",
        "utility_score decimal(5,2) DEFAULT 1.00",
        "prospect_property_id integer",
        "app_id integer",
        "deployment_id integer",
        "scope text DEFAULT 'private'",
        "owner_id integer",
        "embedding text",
        "mission_id integer"
    ];
    for (const colDef of knCols) {
        const colName = colDef.split(" ")[0];
        try {
            await db.execute(sql.raw(`ALTER TABLE knowledge_nodes ADD COLUMN IF NOT EXISTS ${colDef};`));
        } catch (e: any) {
            console.log(`Failed to add ${colName}:`, e.message);
        }
    }
    
    console.log("Columns added successfully.");
    process.exit(0);
}

main().catch(err => {
    console.error("Failed to alter table:", err);
    process.exit(1);
});
