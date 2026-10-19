
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
dotenv.config();

async function introspect() {
    console.log("Introspecting admin_roles table...");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();

    try {
        const columns = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'admin_roles'
        `);
        console.log("Columns in admin_roles:", JSON.stringify(columns.rows, null, 2));
        
        const roles = await client.query("SELECT * FROM admin_roles");
        console.log("Current entries in admin_roles:", JSON.stringify(roles.rows, null, 2));

        const usersRes = await client.query("SELECT id, username, email FROM users WHERE email = 'admin@example.com'");
        console.log("admin@example.com user details:", JSON.stringify(usersRes.rows, null, 2));

    } catch (e: any) {
        console.error("❌ Introspection failed:", e.message);
    } finally {
        client.release();
        await pool.end();
    }
}

introspect();

