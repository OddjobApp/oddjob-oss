import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        console.log('🔧 Fixing admin user organization assignment...\n');

        // Update admin user to use Org 1
        await pool.query('UPDATE users SET default_org_id = 1 WHERE username = $1', ['admin']);
        console.log('✅ Updated admin user default_org_id to 1');

        // Update user_orgs mapping
        await pool.query('DELETE FROM user_orgs WHERE user_id = (SELECT id FROM users WHERE username = $1)', ['admin']);
        await pool.query('INSERT INTO user_orgs (user_id, org_id) SELECT id, 1 FROM users WHERE username = $1', ['admin']);
        console.log('✅ Updated admin user_orgs mapping to Org 1');

        console.log('\n✨ Done! Admin user is now assigned to Org 1 (Acme Corp)');
        console.log('Jobs and pipelines are available in Org 1.');

    } finally {
        await pool.end();
    }
}

main();
