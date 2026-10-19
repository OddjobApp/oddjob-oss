
import { db } from "../server/database_service.js";
import { sql } from "drizzle-orm";

async function main() {
    await db.execute(sql`ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS mission_concurrency integer DEFAULT 1 NOT NULL`);
    console.log('Migration complete');
    process.exit(0);
}

main().catch(console.error);
