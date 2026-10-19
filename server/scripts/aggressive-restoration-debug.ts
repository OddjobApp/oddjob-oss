import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';

async function main() {
    const logPath = 'schema_restore_debug.log';
    fs.writeFileSync(logPath, "Starting Aggressive Schema Restoration Debug Log...\n");
    const log = (msg: string) => {
        console.log(msg);
        fs.appendFileSync(logPath, msg + "\n");
    };

    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    log(`Using Connection String: ${process.env.DATABASE_URL?.substring(0, 20)}...`);

    try {
        const query = async (text: string) => {
            log(`Executing SQL: ${text}`);
            try {
                const res = await pool.query(text);
                log(`  -> SUCCESS. Rows affected: ${res.rowCount}`);
            } catch (e: any) {
                log(`  -> ERROR: ${e.message}`);
            }
        };

        // 1. Missions tables
        await query("CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())");
        await query("CREATE TABLE IF NOT EXISTS mission_runs (id SERIAL PRIMARY KEY, mission_id INTEGER REFERENCES missions(id) ON DELETE CASCADE, status TEXT DEFAULT 'running', started_at TIMESTAMP DEFAULT NOW(), completed_at TIMESTAMP)");

        // 2. Add columns
        await query("ALTER TABLE knowledge_nodes ADD COLUMN mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL");
        await query("ALTER TABLE knowledge_edges ADD COLUMN mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL");
        await query("ALTER TABLE pipeline_executions ADD COLUMN mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL");
        await query("ALTER TABLE approval_requests ADD COLUMN modified_output JSONB");

        log("\nRestoration run finished.");

    } catch (e: any) {
        log(`FATAL ERROR: ${e.message}\n${e.stack}`);
    } finally {
        await pool.end();
        process.exit(0);
    }
}
main();

