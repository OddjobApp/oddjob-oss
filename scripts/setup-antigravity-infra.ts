
import { pool } from "../server/database_service.js";

async function setupAntigravitySchema() {
    console.log("=== Setting up Antigravity Escalation Infrastructure ===");

    const client = await pool.connect();
    try {
        await client.query("BEGIN;");

        // 1. Create Enum if it doesn't exist
        console.log("🚀 Ensuring 'antigravity_incident_status' enum exists...");
        await client.query(`
            DO $$ BEGIN
                CREATE TYPE antigravity_incident_status AS ENUM ('pending', 'investigating', 'resolved');
            EXCEPTION
                WHEN duplicate_object THEN null;
            END $$;
        `);

        // 2. Create Table
        console.log("🚀 Creating 'antigravity_incidents' table...");
        await client.query(`
            CREATE TABLE IF NOT EXISTS antigravity_incidents (
                id SERIAL PRIMARY KEY,
                mission_run_id INTEGER NOT NULL REFERENCES mission_runs(id),
                description TEXT NOT NULL,
                context JSONB NOT NULL,
                status antigravity_incident_status NOT NULL DEFAULT 'pending',
                trace_id TEXT,
                resolution TEXT,
                resolved_at TIMESTAMP,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            );
        `);

        // 3. Add index
        console.log("🚀 Creating index on 'mission_run_id'...");
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_antigravity_incidents_mission_run_id 
            ON antigravity_incidents(mission_run_id);
        `);

        await client.query("COMMIT;");
        console.log("✅ Antigravity database infrastructure established.");
    } catch (err: any) {
        await client.query("ROLLBACK;");
        console.error("❌ Failed to setup Antigravity infrastructure:", err);
        process.exit(1);
    } finally {
        client.release();
        process.exit(0);
    }
}

setupAntigravitySchema();
