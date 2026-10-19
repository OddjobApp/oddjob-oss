import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        const username = 'admin';
        const orgId = 3;

        const userRes = await pool.query("SELECT id FROM users WHERE username = $1", [username]);
        if (userRes.rows.length === 0) {
            console.error(`User ${username} not found`);
            return;
        }
        const userId = userRes.rows[0].id;

        console.log(`Setting default_org_id = ${orgId} for user ${username} (ID: ${userId})`);
        await pool.query("UPDATE users SET default_org_id = $1 WHERE id = $2", [orgId, userId]);

        console.log(`Adding user ${username} to Org ${orgId} in user_orgs`);
        await pool.query("INSERT INTO user_orgs (user_id, org_id) VALUES ($1, $2) ON CONFLICT (user_id, org_id) DO NOTHING", [userId, orgId]);

        console.log("✅ Success!");
    } finally {
        await pool.end();
    }
}
main();
