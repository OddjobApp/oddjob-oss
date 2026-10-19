import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        const res = await pool.query("SELECT * FROM orgs LIMIT 1");
        console.log('Orgs columns:', Object.keys(res.rows[0] || {}));
        console.log('Sample Org:', res.rows[0]);

    } finally {
        await pool.end();
    }
}
main();
