import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        const adminUser = await pool.query("SELECT id, username FROM users WHERE username = 'admin'");
        if (adminUser.rows.length === 0) {
            console.log("Admin user not found");
            return;
        }
        const adminId = adminUser.rows[0].id;

        // 1. Set default_org_id to 3
        await pool.query("UPDATE users SET default_org_id = 3 WHERE id = $1", [adminId]);
        console.log(`Updated admin user (${adminId}) default_org_id to 3`);

        // 2. Add to user_orgs if not already there
        const existing = await pool.query("SELECT * FROM user_orgs WHERE user_id = $1 AND org_id = 3", [adminId]);
        if (existing.rows.length === 0) {
            await pool.query("INSERT INTO user_orgs (user_id, org_id) VALUES ($1, 3)", [adminId]);
            console.log(`Added admin user to Org 3 in user_orgs`);
        } else {
            console.log(`Admin user already in Org 3 in user_orgs`);
        }

    } finally {
        await pool.end();
    }
}
main();
