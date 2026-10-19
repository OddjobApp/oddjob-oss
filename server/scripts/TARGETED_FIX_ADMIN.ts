
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

async function fix() {
    console.log("Fixing Admin Role for admin@example.com...");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();

    try {
        await client.query("BEGIN;");
        
        // 1. Get user ID
        const res = await client.query("SELECT id FROM users WHERE email = $1", ['admin@example.com']);
        if (res.rows.length === 0) {
            console.error("User admin@example.com not found!");
            return;
        }
        const userId = res.rows[0].id;
        console.log(`Found User ID: ${userId}`);

        // 2. Insert or Update Admin Role
        // We use ON CONFLICT because the table has a unique index on user_id
        await client.query(`
            INSERT INTO admin_roles (user_id, role, organization_id)
            VALUES ($1, 'super_admin', NULL)
            ON CONFLICT (user_id) 
            DO UPDATE SET role = 'super_admin', organization_id = NULL;
        `, [userId]);

        await client.query("COMMIT;");
        console.log("✅ Admin Role successfully restored for admin@example.com!");
        
    } catch (e: any) {
        await client.query("ROLLBACK;");
        console.error("❌ Fix failed:", e.message);
    } finally {
        client.release();
        await pool.end();
    }
}

fix();

