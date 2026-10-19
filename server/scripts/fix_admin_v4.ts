
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

async function fix() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    try {
        const client = await pool.connect();
        try {
            const email = "admin@example.com";
            console.log(`=== Fixing User: ${email} ===`);
            
            // 1. Get User ID
            const userRes = await client.query("SELECT id FROM users WHERE email = $1;", [email]);
            if (userRes.rows.length === 0) {
                console.log("❌ User not found.");
                return;
            }
            const userId = userRes.rows[0].id;

            // 2. Set Default Org to 67 (Oddjob Global) and username to 'admin'
            console.log("Setting default organization to 67...");
            await client.query("UPDATE users SET default_org_id = 67, username = 'admin' WHERE id = $1;", [userId]);

            // 3. Upgrade to Super Admin (Global, org_id = null)
            console.log("Upgrading to Super Admin...");
            await client.query("DELETE FROM admin_roles WHERE user_id = $1;", [userId]);
            await client.query("INSERT INTO admin_roles (user_id, role_type, organization_id) VALUES ($1, $2, $3);", [userId, "super_admin", null]);

            // 4. Connect User to Org 67 in user_orgs
            console.log("Connecting user to Org 67 in user_orgs...");
            await client.query("INSERT INTO user_orgs (user_id, org_id) VALUES ($1, 67) ON CONFLICT DO NOTHING;", [userId]);

            // 5. Update ALL existing missions and templates to Org 67 so the user sees them
            console.log("Updating all missions/templates to Org 67...");
            await client.query("UPDATE missions SET organization_id = 67;");
            await client.query("UPDATE mission_templates SET organization_id = 67;");

            console.log("✅ Admin fix V4 complete.");
        } finally {
            client.release();
        }
    } catch (err: any) {
        console.error("Fix error:", err.message);
    } finally {
        await pool.end();
    }
}

fix();

