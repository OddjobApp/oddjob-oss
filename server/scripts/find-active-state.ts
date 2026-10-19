
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

async function query() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    try {
        const client = await pool.connect();
        try {
            console.log("--- Active Executions ---");
            const execs = await client.query("SELECT id, mission_id, status FROM pipeline_executions WHERE status NOT IN ('completed', 'failed') LIMIT 10;");
            console.log(JSON.stringify(execs.rows, null, 2));

            console.log("\n--- Active Mission Runs ---");
            const runs = await client.query("SELECT id, name, mission_id, pipeline_execution_id, status FROM mission_runs WHERE status = 'active' LIMIT 10;");
            console.log(JSON.stringify(runs.rows, null, 2));
        } finally {
            client.release();
        }
    } catch (err: any) {
        console.error("Database error:", err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

query();

