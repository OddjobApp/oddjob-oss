
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
            console.log("=== FINAL ADMIN FIX: AUTH & ORG SYNC ===");
            
            // 1. Clear out the 'admin' username to avoid conflicts
            console.log("Cleaning up conflicting 'admin' users...");
            await client.query("UPDATE users SET username = 'admin_legacy' WHERE username = 'admin' AND email != 'admin@example.com';");

            // 2. Set admin@example.com's username to 'admin'
            console.log("Setting admin@example.com's username to 'admin'...");
            await client.query("UPDATE users SET username = 'admin', default_org_id = 67 WHERE email = 'admin@example.com';");

            // 3. Get User ID
            const userRes = await client.query("SELECT id FROM users WHERE email = 'admin@example.com';");
            const userId = userRes.rows[0].id;

            // 4. Set as Super Admin in roles
            console.log("Setting super_admin role...");
            await client.query("DELETE FROM admin_roles WHERE user_id = $1;", [userId]);
            await client.query("INSERT INTO admin_roles (user_id, role_type, organization_id) VALUES ($1, 'super_admin', null);", [userId]);

            // 5. Connect to Org 67
            console.log("Connecting user to Org 67...");
            await client.query("INSERT INTO user_orgs (user_id, org_id) VALUES ($1, 67) ON CONFLICT DO NOTHING;", [userId]);

            // 6. Ensure ALL data is tagged correctly for visibility
            console.log("Syncing all missions and templates to Org 67...");
            await client.query("UPDATE missions SET organization_id = 67;");
            await client.query("UPDATE mission_templates SET organization_id = 67;");

            console.log("✅ Fix Success. Please login again.");
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

