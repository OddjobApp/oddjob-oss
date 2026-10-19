
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

async function fix() {
    console.log("Fixing Admin Role for admin@example.com (0efad9e1-134e-4163-95b3-0d4c03420712)...");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();

    try {
        await client.query("BEGIN;");
        
        const userId = '0efad9e1-134e-4163-95b3-0d4c03420712';

        // Delete any existing entries for this user just in case
        await client.query("DELETE FROM admin_roles WHERE user_id = $1", [userId]);

        // Insert new record
        await client.query(`
            INSERT INTO admin_roles (user_id, role, organization_id)
            VALUES ($1, 'super_admin', NULL);
        `, [userId]);

        await client.query("COMMIT;");
        console.log("✅ Admin Role successfully created for admin@example.com!");
        
    } catch (e: any) {
        await client.query("ROLLBACK;");
        console.error("❌ Fix failed:", e.message);
    } finally {
        client.release();
        await pool.end();
    }
}

fix();

