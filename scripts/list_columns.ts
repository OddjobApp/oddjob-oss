
import { db } from "../server/database_service.js";
import { sql } from "drizzle-orm";

async function main() {
    const result = await db.execute(sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'org_settings'`);
    console.log('COLUMNS:', result.rows);
    process.exit(0);
}

main().catch(console.error);
