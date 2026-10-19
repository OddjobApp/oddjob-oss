import { db } from "../../server/database_service.js";
import { sql } from "drizzle-orm";

async function verify() {
    try {
        console.log("Verifying app_deployments columns...");
        const result = await db.execute(sql`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'app_deployments' 
            AND column_name IN ('app_token_hash', 'app_token_encrypted', 'app_token_capabilities');
        `);
        console.table(result.rows);

        console.log("\nVerifying pipelines constraints...");
        const pipeResult = await db.execute(sql`
            SELECT indexname 
            FROM pg_indexes 
            WHERE tablename = 'pipelines' 
            AND indexname = 'pipelines_org_name_unique';
        `);
        console.table(pipeResult.rows);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

verify();
