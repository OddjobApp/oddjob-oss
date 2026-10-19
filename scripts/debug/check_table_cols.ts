import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'");
        console.log('Users columns:', res.rows.map((r: any) => r.column_name));

        const res2 = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'organizations'");
        console.log('Orgs columns:', res2.rows.map((r: any) => r.column_name));

    } finally {
        await pool.end();
    }
}
main();
