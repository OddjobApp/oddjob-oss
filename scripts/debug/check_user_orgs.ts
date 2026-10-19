
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

async function run() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log("Checking Organizations...");
        const orgsRes = await pool.query("SELECT org_id, name FROM orgs");
        console.log("Organizations:", JSON.stringify(orgsRes.rows, null, 2));

        console.log("Checking Users...");
        const usersRes = await pool.query("SELECT id, username, default_org_id FROM users WHERE username = 'admin'");
        console.log("Users:", JSON.stringify(usersRes.rows, null, 2));

        const user = usersRes.rows[0];
        if (user) {
            console.log("Checking user memberships in user_orgs...");
            const memberships = await pool.query("SELECT * FROM user_orgs WHERE user_id = $1", [user.id]);
            console.log("Memberships:", JSON.stringify(memberships.rows, null, 2));
        }

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

run();
