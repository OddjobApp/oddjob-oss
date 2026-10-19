import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        const users = await pool.query("SELECT id, username, organization_id, is_admin FROM users");
        console.log('Users in DB:');
        users.rows.forEach((r: any) => console.log(`  ID: ${r.id} | Username: ${r.username} | Org: ${r.organization_id} | Admin: ${r.is_admin}`));

        const orgs = await pool.query("SELECT id, name FROM organizations");
        console.log('\nOrganizations in DB:');
        orgs.rows.forEach((r: any) => console.log(`  ID: ${r.id} | Name: ${r.name}`));

    } finally {
        await pool.end();
    }
}
main();
