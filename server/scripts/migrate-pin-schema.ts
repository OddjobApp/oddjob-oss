import "dotenv/config";
import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function runPinMigration() {
    console.log("🛠️ Running PIN schema migration...");
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pin TEXT;`);
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS pin_reset_tokens (
            id SERIAL PRIMARY KEY,
            user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            used BOOLEAN DEFAULT false NOT NULL,
            created_at TIMESTAMP DEFAULT NOW() NOT NULL
        );
    `);
    console.log("✅ PIN schema migration completed successfully.");
    process.exit(0);
}

runPinMigration().catch((err) => {
    console.error("❌ Migration failed:", err);
    process.exit(1);
});
