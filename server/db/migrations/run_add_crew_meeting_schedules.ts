import { pool } from "../../database_service.js";

async function run() {
    const client = await pool.connect();
    try {
        console.log("Running migration for crew_meeting_schedules...");
        await client.query(`
            CREATE TABLE IF NOT EXISTS crew_meeting_schedules (
                id SERIAL PRIMARY KEY,
                organization_id INTEGER NOT NULL,
                project_id INTEGER,
                title TEXT NOT NULL,
                agenda TEXT,
                status TEXT NOT NULL DEFAULT 'proposed',
                host_user_id TEXT NOT NULL,
                candidate_slots JSONB NOT NULL DEFAULT '[]'::jsonb,
                confirmed_slot JSONB,
                requested_attendees JSONB NOT NULL DEFAULT '[]'::jsonb,
                created_session_key TEXT,
                reminder_minutes_before INTEGER DEFAULT 15,
                bullmq_job_id TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMP NOT NULL DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_crew_meeting_schedules_org ON crew_meeting_schedules(organization_id);
            CREATE INDEX IF NOT EXISTS idx_crew_meeting_schedules_project ON crew_meeting_schedules(project_id);
            CREATE INDEX IF NOT EXISTS idx_crew_meeting_schedules_status ON crew_meeting_schedules(status);
        `);
        console.log("Migration crew_meeting_schedules applied successfully.");
    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        client.release();
        process.exit(0);
    }
}

run();
