
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function check() {
    const client = await pool.connect();
    try {
        const res = await client.query("SELECT * FROM pipeline_executions WHERE id = 238");
        console.log(res.rows[0]);
    } catch (err) {
        console.error(err);
    } finally {
        client.release();
        await pool.end();
    }
}

check();
