
import { db } from "../server/database_service.js";
import { sql } from "drizzle-orm";

async function main() {
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "user_platform_identities" (
            "id" serial PRIMARY KEY,
            "user_id" text NOT NULL,
            "organization_id" integer NOT NULL,
            "platform" text NOT NULL,
            "platform_user_id" text NOT NULL,
            "platform_username" text,
            "created_at" timestamp DEFAULT now() NOT NULL,
            "updated_at" timestamp DEFAULT now() NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS "platform_user_idx" ON "user_platform_identities" ("platform", "platform_user_id", "organization_id");
    `);
    console.log('Table user_platform_identities created successfully');
    process.exit(0);
}

main().catch(console.error);
