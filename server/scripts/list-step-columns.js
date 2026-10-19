
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
        const res = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'pipeline_step_executions'
      ORDER BY ordinal_position
    `);
        console.log('Columns in pipeline_step_executions:');
        res.rows.forEach(r => console.log(`- ${r.column_name} (${r.data_type})`));
    } finally {
        client.release();
        await pool.end();
    }
}

check();
