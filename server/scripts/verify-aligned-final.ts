import 'dotenv/config';
import pg from 'pg';

async function main() {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
        const check = async (table: string, col: string) => {
            const res = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = '${table}' AND column_name = '${col}'`);
            console.log(`${table}.${col}: ${res.rows.length > 0 ? 'PRESENT' : 'MISSING'}`);
        };
        await check('pipeline_executions', 'mission_id');
        await check('approval_requests', 'modified_output');
        await check('knowledge_nodes', 'mission_id');
        await check('knowledge_edges', 'mission_id');
    } finally {
        await pool.end();
        process.exit(0);
    }
}
main();

