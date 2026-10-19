import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        const res = await pool.query("SELECT org_id, name FROM orgs WHERE org_id = 3");
        console.log('Org 3:', res.rows);

    } finally {
        await pool.end();
    }
}
main();
