
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
        const res = await client.query('SELECT id, name FROM pipelines');
        console.log(JSON.stringify(res.rows, null, 2));
    } finally {
        client.release();
        await pool.end();
    }
}

check();
