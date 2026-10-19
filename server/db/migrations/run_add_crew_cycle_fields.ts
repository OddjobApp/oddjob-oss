import { db } from "../../database_service.js";
import { sql } from "drizzle-orm";

async function runMigration() {
    try {
        console.log("Running migration: adding cycle columns to crew_sessions...");
        await db.execute(sql`
            ALTER TABLE crew_sessions 
            ADD COLUMN IF NOT EXISTS cycle_slug text,
            ADD COLUMN IF NOT EXISTS cycle_stage_id text,
            ADD COLUMN IF NOT EXISTS cycle_context jsonb,
            ADD COLUMN IF NOT EXISTS parent_session_id integer REFERENCES crew_sessions(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS active_topic text,
            ADD COLUMN IF NOT EXISTS next_steps text,
            ADD COLUMN IF NOT EXISTS consensus_level integer,
            ADD COLUMN IF NOT EXISTS interrupting boolean DEFAULT false NOT NULL,
            ADD COLUMN IF NOT EXISTS last_round_completed_at timestamp;
        `);

        await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_crew_sessions_cycle ON crew_sessions (organization_id, cycle_slug);
            CREATE INDEX IF NOT EXISTS idx_crew_sessions_parent ON crew_sessions (parent_session_id);
        `);

        console.log("Migration successful: added cycle_slug, cycle_stage_id, cycle_context to crew_sessions.");
    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        process.exit(0);
    }
}

runMigration();
