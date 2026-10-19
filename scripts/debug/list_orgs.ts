import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        const res = await pool.query("SELECT id, name FROM orgs");
        console.log('Orgs:', res.rows);

    } finally {
        await pool.end();
    }
}
main();
