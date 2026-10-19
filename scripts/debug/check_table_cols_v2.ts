import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        const tables = ['users', 'orgs', 'user_orgs'];
        for (const table of tables) {
            const res = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = '${table}'`);
            console.log(`${table} columns:`, res.rows.map((r: any) => r.column_name));
        }

    } finally {
        await pool.end();
    }
}
main();
