import { db } from "../../server/database_service.js";
import { sql } from "drizzle-orm";

async function checkDuplicates() {
    try {
        console.log("Checking for duplicate Pipelines (Org + Name)...");
        const pipelines = await db.execute(sql`
            SELECT organization_id, name, COUNT(*) 
            FROM pipelines 
            GROUP BY organization_id, name 
            HAVING COUNT(*) > 1;
        `);
        console.table(pipelines.rows);

        process.exit(0);
    } catch (err) {
        console.error("Failed to check duplicates:", err);
        process.exit(1);
    }
}

checkDuplicates();
