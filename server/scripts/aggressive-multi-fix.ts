import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';

async function main() {
    const logPath = 'aggressive_multi_fix.log';
    fs.writeFileSync(logPath, "Starting Multi-Target Schema Fix...\n");
    const log = (msg: string) => { console.log(msg); fs.appendFileSync(logPath, msg + "\n"); };

    const targets = [
        "postgresql://postgres:postgres@127.0.0.1:5433/oddjob",
        "postgresql://postgres:ShitMonger01!@127.0.0.1:5432/oddjob",
        "postgresql://postgres:postgres@127.0.0.1:5432/oddjob"
    ];

    for (const url of targets) {
        log(`\n========================================`);
        log(`Targeting URL: ${url.substring(0, 30)}...`);
        const pool = new pg.Pool({ connectionString: url });
        try {
            const query = async (text: string) => {
                log(`Executing: ${text.substring(0, 60)}...`);
                try {
                    await pool.query(text);
                    log(`  -> SUCCESS.`);
                } catch (e: any) {
                    log(`  -> INFO/ERROR: ${e.message}`);
                }
            };

            // 1. Core Tables
            await query("CREATE TABLE IF NOT EXISTS missions (id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())");
            await query("CREATE TABLE IF NOT EXISTS mission_runs (id SERIAL PRIMARY KEY, mission_id INTEGER REFERENCES missions(id) ON DELETE CASCADE, status TEXT DEFAULT 'running', started_at TIMESTAMP DEFAULT NOW(), completed_at TIMESTAMP)");

            // 2. Add Columns
            await query("ALTER TABLE knowledge_nodes ADD COLUMN mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL");
            await query("ALTER TABLE knowledge_edges ADD COLUMN mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL");
            await query("ALTER TABLE pipeline_executions ADD COLUMN mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL");
            await query("ALTER TABLE approval_requests ADD COLUMN modified_output JSONB");

            // 3. Organization Repair
            await query("INSERT INTO orgs (org_id, name) VALUES (1, 'Acme') ON CONFLICT DO NOTHING");
            await query("INSERT INTO org_settings (organization_id, knowledge_store_enabled, knowledge_graph_enabled) VALUES (1, true, true) ON CONFLICT (organization_id) DO UPDATE SET knowledge_graph_enabled = true, knowledge_store_enabled = true");

            log(`Fixes applied to ${url.substring(0, 30)}...`);
        } catch (e: any) {
            log(`FAILED to connect to ${url.substring(0, 30)}: ${e.message}`);
        } finally {
            await pool.end();
        }
    }
    log("\nMulti-Target Fix Complete.");
}
main();

