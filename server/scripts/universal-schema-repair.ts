import 'dotenv/config';
import pg from 'pg';

async function main() {
    console.log("Starting Universal Schema Repair...");
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    try {
        const query = async (sql: string) => {
            console.log(`Executing: ${sql}`);
            try {
                await pool.query(sql);
            } catch (e: any) {
                if (e.message.includes("already exists")) {
                    console.log("  -> Already exists, skipping.");
                } else {
                    console.error(`  -> Failed: ${e.message}`);
                }
            }
        };

        // 1. Knowledge Tables
        await query('ALTER TABLE knowledge_nodes ADD COLUMN IF NOT EXISTS mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL');
        await query('ALTER TABLE knowledge_edges ADD COLUMN IF NOT EXISTS mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL');

        // 2. HIL Tables
        await query('ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS modified_output JSONB');

        // 3. Pipeline Tables
        await query('ALTER TABLE pipeline_executions ADD COLUMN IF NOT EXISTS mission_id INTEGER REFERENCES missions(id) ON DELETE SET NULL');
        await query('ALTER TABLE pipeline_executions ADD COLUMN IF NOT EXISTS parent_execution_id INTEGER');
        await query('ALTER TABLE pipeline_executions ADD COLUMN IF NOT EXISTS trace_id VARCHAR(32)');
        await query('ALTER TABLE pipeline_executions ADD COLUMN IF NOT EXISTS sampling_rate DECIMAL(3,2) DEFAULT 1.00');
        await query('ALTER TABLE pipeline_executions ADD COLUMN IF NOT EXISTS trace_source VARCHAR(20)');
        await query('ALTER TABLE pipeline_executions ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMP');
        await query('ALTER TABLE pipeline_executions ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL');
        await query('ALTER TABLE pipeline_executions ADD COLUMN IF NOT EXISTS context_snapshot JSONB');

        // 4. Verification Check
        console.log("\nVerifying Pipeline Executions columns:");
        const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'pipeline_executions'");
        const columns = res.rows.map(r => r.column_name);
        console.log(`  Columns: ${columns.join(", ")}`);

        if (columns.includes('mission_id')) {
            console.log("SUCCESS: Schema aligned.");
        } else {
            console.error("FAILURE: Schema still missing critical columns.");
        }

    } catch (e) {
        console.error("Universal Repair Failed:", e);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

main();

