import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        // Get all rows from orgs table
        const orgs = await pool.query('SELECT * FROM orgs ORDER BY id');
        console.log('Organizations in database:');
        console.log(JSON.stringify(orgs.rows, null, 2));

    } finally {
        await pool.end();
    }
}

main();
