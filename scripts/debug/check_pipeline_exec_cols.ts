import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        const res = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'pipeline_executions'
        `);
        console.log("=== pipeline_executions columns ===");
        res.rows.forEach((r: any) => console.log(`  ${r.column_name}: ${r.data_type}`));
    } finally {
        await pool.end();
    }
}
main();
