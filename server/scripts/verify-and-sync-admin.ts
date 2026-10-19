
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../../.env') });

async function verify() {
    const connectionString = process.env.DATABASE_URL;
    const pool = new Pool({ connectionString });
    try {
        const client = await pool.connect();
        try {
            console.log("=== Database Audit: Admin & Organizations ===");
            
            // 1. Check User
            const userRes = await client.query("SELECT id, username, email, default_org_id FROM users WHERE email = $1;", ["admin@example.com"]);
            if (userRes.rows.length === 0) {
                console.log("❌ User admin@example.com NOT FOUND");
                return;
            }
            const user = userRes.rows[0];
            console.log("✅ User found:", user);

            // 2. Check Roles
            const roleRes = await client.query("SELECT * FROM admin_roles WHERE user_id = $1;", [user.id]);
            console.log("🎭 Roles found:", roleRes.rows);

            // 3. Check All Orgs
            const orgsRes = await client.query("SELECT * FROM orgs;");
            console.log("🏢 Organizations in DB:", orgsRes.rows);

            // 4. Check UserOrgs
            const userOrgRes = await client.query("SELECT * FROM user_orgs WHERE user_id = $1;", [user.id]);
            console.log("🔗 User-Org connections:", userOrgRes.rows);

            // 5. Check Missions & Templates visibility for this user
            const missionsRes = await client.query("SELECT id, name, organization_id FROM missions;");
            console.log(`🚀 Total Missions in DB: ${missionsRes.rows.length}`);
            missionsRes.rows.forEach(m => console.log(`   - [ID: ${m.id}] ${m.name} (Org: ${m.organization_id})`));

            const templatesRes = await client.query("SELECT id, name, organization_id FROM mission_templates;");
            console.log(`📋 Total Templates in DB: ${templatesRes.rows.length}`);
            templatesRes.rows.forEach(t => console.log(`   - [ID: ${t.id}] ${t.name} (Org: ${t.organization_id})`));

        } finally {
            client.release();
        }
    } catch (err: any) {
        console.error("Audit error:", err.message);
    } finally {
        await pool.end();
    }
}

verify();

