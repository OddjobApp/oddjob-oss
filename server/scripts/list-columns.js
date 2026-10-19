import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function listColumns(tableName) {
    const client = await pool.connect();
    try {
        console.log(`--- COLUMNS for ${tableName} ---`);
        const res = await client.query(
            "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1",
            [tableName]
        );
        res.rows.forEach(r => console.log(`- ${r.column_name} (${r.data_type})`));
    } catch (err) {
        console.error("Error listing columns:", err);
    } finally {
        client.release();
        await pool.end();
    }
}

async function run() {
    await listColumns('pipeline_executions');
    await listColumns('pipeline_step_executions');
}

run();
