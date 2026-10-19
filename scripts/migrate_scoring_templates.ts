import 'dotenv/config';
import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function main() {
    console.log("Migrating scoring_rule_templates...");
    try {
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS scoring_rule_templates (
                id text PRIMARY KEY,
                name text NOT NULL,
                description text,
                icon text,
                config jsonb NOT NULL,
                is_system boolean DEFAULT false,
                created_at timestamp DEFAULT now() NOT NULL,
                created_by integer
            );
        `);
        console.log("Migration successful.");
    } catch (e) {
        console.error("Migration failed:", e);
        console.error(e);
        process.exit(1);
    }
    process.exit(0);
}

main();
