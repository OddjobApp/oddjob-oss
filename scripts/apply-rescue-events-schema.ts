
import "dotenv/config";
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function applySchema() {
    const client = await pool.connect();
    try {
        console.log("🛠️ Manually applying rescue_events schema...");

        await client.query(`
      CREATE TABLE IF NOT EXISTS "rescue_events" (
        "id" serial PRIMARY KEY,
        "session_id" integer NOT NULL REFERENCES "rescue_sessions" ("id") ON DELETE CASCADE,
        "event_type" text NOT NULL,
        "previous_status" text,
        "new_status" text,
        "actor_id" text,
        "actor_type" text,
        "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "event_hash" text,
        "previous_event_hash" text,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
    `);

        console.log("✅ rescue_events table verified/created.");
    } catch (err) {
        console.error("❌ Failed to apply schema:", err);
    } finally {
        client.release();
        await pool.end();
    }
}

applySchema();
