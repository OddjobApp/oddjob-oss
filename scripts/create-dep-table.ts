
import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function createTable() {
    console.log("Creating table system_dependencies...");
    try {
        await db.execute(sql`
            CREATE TABLE IF NOT EXISTS "system_dependencies" (
                "id" serial PRIMARY KEY,
                "name" text NOT NULL,
                "version" text NOT NULL,
                "license" text,
                "feature" text,
                "security_alerts_count" integer DEFAULT 0 NOT NULL,
                "vulnerability_details" jsonb DEFAULT '[]'::jsonb,
                "last_synced_at" timestamp DEFAULT now() NOT NULL,
                "organization_id" integer
            )
        `);
        await db.execute(sql`
            CREATE UNIQUE INDEX IF NOT EXISTS "system_dep_name_unique" ON "system_dependencies" ("name")
        `);
        console.log("Table and index created successfully");
    } catch (e) {
        console.error("Creation failed:", e);
    } finally {
        process.exit(0);
    }
}

createTable();
